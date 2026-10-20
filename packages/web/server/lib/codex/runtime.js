import { createCodexRpc } from './rpc.js';
import { contentOf, createWire, messageId, parentThreadIdOf, toMessage, toPublicId, toSession, tokensOf } from './wire.js';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import { createCommunicationReader } from './communications.js';

const threadSchema = z.object({ id: z.uuid(), cwd: z.string(), createdAt: z.number(), updatedAt: z.number(), model: z.string().nullable().optional(), reasoningEffort: z.string().nullable().optional(), name: z.string().nullable().optional(), preview: z.string().optional(), parentThreadId: z.string().nullable().optional(), status: z.object({ type: z.enum(['notLoaded', 'idle', 'systemError', 'active']) }).passthrough() }).passthrough();
const answerSchema = z.union([z.string(), z.array(z.string())]);
const fileSchema = z.object({ uri: z.string().max(8 * 1024 * 1024), name: z.string().optional(), mime: z.string().optional() });
const imageInput = (raw) => {
  const file = fileSchema.parse(raw);
  const data = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(file.uri);
  const url = data ? null : new URL(file.uri);
  const supported = data || (url && ['https:', 'http:', 'file:'].includes(url.protocol) && /\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname));
  if (!supported || (file.mime && !file.mime.startsWith('image/'))) throw Object.assign(new Error('Codex supports image attachments only'), { status: 400 });
  if (url?.protocol === 'file:') return { type: 'localImage', path: fileURLToPath(url) };
  return { type: 'image', url: file.uri };
};
const itemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('agentMessage'), id: z.string(), text: z.string() }).passthrough(),
  z.object({ type: z.literal('plan'), id: z.string(), text: z.string() }).passthrough(),
  z.object({ type: z.literal('reasoning'), id: z.string(), summary: z.array(z.string()), content: z.array(z.string()) }).passthrough(),
  z.object({ type: z.literal('userMessage'), id: z.string(), clientId: z.string().nullable().optional(), content: z.array(z.object({ type: z.string() }).passthrough()) }).passthrough(),
  ...['hookPrompt', 'functionCallOutput', 'commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall', 'subAgentActivity', 'webSearch', 'imageView', 'sleep', 'imageGeneration', 'enteredReviewMode', 'exitedReviewMode', 'contextCompaction'].map((type) => z.object({ type: z.literal(type), id: z.string() }).passthrough()),
]);
const turnSchema = z.object({ id: z.string(), items: z.array(itemSchema), itemsView: z.enum(['full', 'summary', 'notLoaded']), status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']), startedAt: z.number().nullable().optional(), completedAt: z.number().nullable().optional() }).passthrough();
const itemEntrySchema = z.object({ turnId: z.string(), item: itemSchema, startedAtMs: z.number().nullable(), completedAtMs: z.number().nullable() });

export const CODEX_MODES = Object.freeze([
  { id: 'read-only', label: 'Read only', description: 'Read files and ask before commands need more access.' },
  { id: 'workspace-write', label: 'Workspace', description: 'Allow workspace changes. Ask before commands need more access.' },
  { id: 'full-access', label: 'Full access', description: 'Allow commands outside the workspace sandbox without approval prompts.', dangerous: true, isDefault: true },
]);
const modeSettings = (mode) => {
  if (!CODEX_MODES.some((entry) => entry.id === mode)) throw Object.assign(new Error('Unknown Codex mode'), { status: 400 });
  return { sandbox: mode === 'full-access' ? 'danger-full-access' : mode, approvalPolicy: mode === 'full-access' ? 'never' : 'on-request' };
};
const usageKeys = ['inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'];
const usageDifference = (total, baseline) => Object.fromEntries(usageKeys.map((key) => [key, Math.max(0, (total?.[key] || 0) - (baseline?.[key] || 0))]));
const effectiveMode = (response) => {
  if (response.sandbox?.type === 'dangerFullAccess' && response.approvalPolicy === 'never') return 'full-access';
  if (response.sandbox?.type === 'readOnly' && response.approvalPolicy === 'on-request') return 'read-only';
  if (response.sandbox?.type === 'workspaceWrite' && response.approvalPolicy === 'on-request') return 'workspace-write';
  return null;
};

export const createCodexRuntime = ({ publishEvent, rpcFactory = createCodexRpc, communicationReader = createCommunicationReader(), isAutoAccepting = null, evaluatePermission = null, isAllowed = () => true, toWireSession = toSession, ...options } = {}) => {
  const threads = new Map();
  const items = new Map();
  const activeTurns = new Map();
  const turnUsage = new Map();
  const threadUsage = new Map();
  const turnBaselines = new Map();
  const turnLastAssistant = new Map();
  const pending = new Map();
  const starting = new Set();
  const fresh = new Set();
  const chronology = new Map();
  const turnStarts = new Map();
  const communications = communicationReader;
  const subscribed = new Set();
  const sentCommunications = new Map();
  const communicationReads = new Map();
  const rememberCommunications = (id, entries) => {
    const sent = sentCommunications.get(id) || new Map();
    for (const entry of entries) sent.set(entry.item.id, sent.get(entry.item.id) === true || entry.completedAtMs !== null);
    sentCommunications.set(id, sent);
  };
  const { emit } = createWire(publishEvent);
  const rpc = rpcFactory({ ...options, onNotification, onRequest, onDisconnect });
  const threadOf = (id) => threads.get(id) || { id, cwd: '', model: '', createdAt: 0, updatedAt: 0 };
  const remember = (value) => { const thread = threadSchema.parse(value); const previous = threads.get(thread.id); if (previous?.context) { thread.context = previous.context; thread.contextWindow = previous.contextWindow; } if (previous && Object.hasOwn(previous, 'mode')) thread.mode = previous.mode; threads.set(thread.id, thread); return thread; };
  const rememberResponse = (response) => {
    const thread = remember(response.thread);
    if (response.sandbox !== undefined || response.approvalPolicy !== undefined) thread.mode = effectiveMode(response);
    return thread;
  };
  const childIdsOf = (thread, item) => {
    const receivers = item.type === 'subAgentActivity' ? [item.agentThreadId] : item.receiverThreadIds || [];
    return new Set(receivers.filter((id) => id !== thread.id && id !== parentThreadIdOf(thread) && (parentThreadIdOf(threads.get(id) || {}) === thread.id || (item.type === 'collabAgentToolCall' && item.tool === 'spawnAgent' && item.senderThreadId === thread.id))));
  };
  const orderedTime = (thread, itemId, nativeTime) => {
    let state = chronology.get(thread.id);
    if (!state) { state = { times: new Map(), last: -1, revision: 0 }; chronology.set(thread.id, state); }
    if (state.times.has(itemId)) return state.times.get(itemId);
    // Native item order breaks timestamp ties; IDs remain identity only.
    const time = Math.max(nativeTime ?? thread.createdAt * 1000, state.last + 1);
    state.times.set(itemId, time);
    state.last = time;
    state.revision += 1;
    return time;
  };
  const pages = async (method, params = {}) => {
    const entries = [];
    const cursors = new Set();
    let cursor;
    do {
      const request = { ...params, limit: 100 };
      if (cursor) request.cursor = cursor;
      const result = await rpc.request(method, request);
      if (!result || !Array.isArray(result.data)) throw new Error(`Invalid Codex ${method} response`);
      entries.push(...result.data);
      cursor = result.nextCursor;
      if (cursor && cursors.has(cursor)) throw new Error('Codex returned a repeated history cursor');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return entries;
  };
  const sessionData = (threadId) => ({ sessionID: toPublicId(threadId) });
  const settle = (id, result, cancelled = false) => {
    const entry = pending.get(id);
    if (!entry) return false;
    rpc.respond(entry.rpcId, result);
    pending.delete(id);
    const event = { ...sessionData(entry.threadId) };
    if (entry.kind === 'permission') { event.requestID = id; event.reply = result.decision === 'decline' ? 'reject' : result.decision === 'acceptForSession' ? 'always' : 'once'; }
    else { event.id = id; if (!cancelled) event.answer = result.answers; }
    emit(entry.kind === 'permission' ? 'permission.replied' : cancelled ? 'form.cancelled' : 'form.replied', threadOf(entry.threadId), event);
    return true;
  };
  function onDisconnect() {
    for (const entry of pending.values()) emit(entry.kind === 'permission' ? 'permission.replied' : 'form.cancelled', threadOf(entry.threadId), { ...sessionData(entry.threadId), id: entry.request.id, requestID: entry.request.id, reply: 'reject' });
    pending.clear();
    for (const threadId of activeTurns.keys()) emit('session.execution.failed', threadOf(threadId), { ...sessionData(threadId), error: { type: 'CodexDisconnected', message: 'Codex disconnected. Refresh the session to recover its current state.' } });
    activeTurns.clear();
    turnUsage.clear();
    threadUsage.clear();
    turnBaselines.clear();
    turnLastAssistant.clear();
    items.clear();
    fresh.clear();
    chronology.clear();
    turnStarts.clear();
  }
  function onRequest(request) {
    const params = request.params || {};
    const thread = threads.get(params.threadId);
    const approval = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(request.method);
    const form = request.method === 'item/tool/requestUserInput';
    // Never grant unsupported permissions or answer auth/native-tool requests.
    const supportedCommand = !request.method.includes('commandExecution') || params.kind === undefined || ['command', 'writeStdin'].includes(params.kind);
    if (!isAllowed() || !thread || !supportedCommand || (!approval && !form) || (form && params.questions?.some((question) => question.isSecret))) {
      if (approval) rpc.respond(request.id, { decision: 'decline' });
      else if (form) rpc.respond(request.id, { answers: {} });
      else if (request.method === 'mcpServer/elicitation/request') rpc.respond(request.id, { action: 'decline', content: null, _meta: null });
      else rpc.reject(request.id, 'This Codex client does not support this request');
      return;
    }
    const id = `${approval ? 'per' : 'frm'}_cdx${Buffer.from(String(request.id)).toString('hex')}`;
    const wire = approval ? {
      id, ...sessionData(thread.id), action: request.method.includes('commandExecution') ? 'shell' : 'edit',
      resources: [params.command || params.grantRoot || thread.cwd], save: ['This session'],
      metadata: { command: params.command, description: params.reason, codex: { itemId: params.itemId, kind: params.kind } },
    } : {
      id, ...sessionData(thread.id), title: 'Codex has a question',
      fields: (params.questions || []).map((question) => ({ key: question.id, type: 'string', title: question.question, description: question.header, required: true, custom: question.isOther, options: (question.options || []).map((option) => ({ value: option.label, label: option.label, description: option.description })) })),
    };
    pending.set(id, { kind: approval ? 'permission' : 'form', threadId: thread.id, rpcId: request.id, request: wire, params });
    if (approval && isAutoAccepting) {
      void (async () => {
        try {
          if (!await isAutoAccepting(toPublicId(thread.id), thread.cwd)) return emit('permission.asked', thread, wire);
          const verdict = evaluatePermission ? await evaluatePermission(wire, thread.cwd) : null;
          if (!isAllowed()) { settle(id, { decision: 'decline' }); return; }
          if (verdict?.action === 'hold') return emit('permission.asked', thread, wire);
          if (!pending.has(id)) return;
          settle(id, { decision: 'accept' });
        } catch { if (pending.has(id)) emit('permission.asked', thread, wire); }
      })();
      return;
    }
    emit(approval ? 'permission.asked' : 'form.created', thread, approval ? wire : { form: wire });
  }
  const startItem = (thread, entry) => {
    const item = entry.item;
    const nativeTime = entry.startedAtMs ?? turnStarts.get(entry.turnId);
    const created = orderedTime(thread, item.id, nativeTime);
    const message = toMessage({ ...entry, createdAtMs: created }, thread, null, childIdsOf(thread, item));
    if (!message) return;
    const base = { ...sessionData(thread.id), assistantMessageID: message.id };
    if (message.type === 'user') {
      emit('session.inbox.enqueued', thread, { ...sessionData(thread.id), inboxID: message.id, item: { type: 'user', payload: { text: message.text, files: message.files }, delivery: 'queue' } }, created);
      emit('session.inbox.delivered', thread, { ...sessionData(thread.id), inboxID: message.id }, created);
      return;
    }
    if (message.type === 'compaction') { emit('session.compaction.started', thread, { ...sessionData(thread.id), inputID: message.id, reason: 'auto' }, created); return; }
    if (message.type !== 'assistant') return;
    emit('session.step.started', thread, { ...base, agent: 'codex', model: message.model, started: created, metadata: { codex: { usageScope: 'turn' } } }, created);
    if (entry.turnId) turnLastAssistant.set(entry.turnId, message.id);
    const content = message.content[0];
    if (content.type === 'tool') {
      emit('session.tool.input.started', thread, { ...base, id: content.id, name: content.name });
      emit('session.tool.called', thread, { ...base, id: content.id, input: content.state.input, executed: true });
      if (content.state.metadata) emit('session.tool.progress', thread, { ...base, id: content.id, metadata: content.state.metadata });
    } else {
      emit(`session.${content.type}.started`, thread, { ...base, ordinal: 0 });
      if (content.text) emit(`session.${content.type}.delta`, thread, { ...base, ordinal: 0, delta: content.text });
    }
    items.set(item.id, { ...entry, messageID: message.id, threadId: thread.id, content });
  };
  const finishItem = (thread, entry, finish = 'stop') => {
    if (entry.item.type === 'subAgentActivity' && !childIdsOf(thread, entry.item).size) return;
    if (entry.item.type === 'userMessage') return;
    if (entry.item.type === 'contextCompaction') {
      thread.context = { state: 'compacted', window: thread.contextWindow || null };
      const session = toWireSession(thread);
      emit('session.metadata.updated', thread, { sessionID: session.id, metadata: session.metadata });
      emit('session.compaction.ended', thread, { ...sessionData(thread.id), reason: 'auto', text: '', cost: 0, tokens: tokensOf() }); return;
    }
    if (!items.has(entry.item.id)) startItem(thread, { ...entry, completedAtMs: undefined });
    const tracked = items.get(entry.item.id);
    if (!tracked) return;
    const content = contentOf(entry.item, entry.startedAtMs || Date.now(), entry.completedAtMs || Date.now(), childIdsOf(thread, entry.item));
    const base = { ...sessionData(thread.id), assistantMessageID: tracked.messageID };
    if (content?.type === 'tool') emit(content.state.status === 'error' ? 'session.tool.failed' : 'session.tool.success', thread, { ...base, id: content.id, ...content.state, executed: true });
    else if (content) emit(`session.${content.type}.ended`, thread, { ...base, ordinal: 0, text: content.text });
    emit('session.step.ended', thread, { ...base, finish, cost: 0, tokens: tokensOf() });
    items.delete(entry.item.id);
  };
  function onNotification(method, params) {
    const thread = threadOf(params.threadId || params.thread?.id);
    if (method === 'thread/started') {
      const child = remember(params.thread);
      if (parentThreadIdOf(child)) {
        const session = toWireSession(child);
        emit('session.created', child, { sessionID: session.id, parentID: session.parentID, projectID: session.projectID, location: session.location, subpath: session.subpath, title: session.title, agent: session.agent, model: session.model, metadata: session.metadata, slug: `codex-${child.id.slice(-8)}`, version: '2' });
      }
      return;
    }
    if (method === 'thread/tokenUsage/updated') {
      thread.contextWindow = params.tokenUsage?.modelContextWindow || null;
      thread.context = { state: 'measured', tokens: params.tokenUsage?.last?.totalTokens ?? null, window: thread.contextWindow };
      const total = params.tokenUsage?.total;
      if (total) {
        if (!turnBaselines.has(params.turnId)) turnBaselines.set(params.turnId, threadUsage.get(thread.id) || usageDifference(total, params.tokenUsage?.last));
        turnUsage.set(params.turnId, usageDifference(total, turnBaselines.get(params.turnId)));
        threadUsage.set(thread.id, total);
      }
      const session = toWireSession(thread);
      emit('session.metadata.updated', thread, { sessionID: session.id, metadata: session.metadata });
      return;
    }
    if (method === 'thread/status/changed') { if (threads.has(thread.id)) thread.status = params.status; emit('session.status', thread, { ...sessionData(thread.id), status: { type: params.status?.type === 'active' ? 'busy' : 'idle' } }); return; }
    if (method === 'turn/started') { activeTurns.set(thread.id, params.turn.id); if (threadUsage.has(thread.id)) turnBaselines.set(params.turn.id, threadUsage.get(thread.id)); chronology.get(thread.id)?.times.clear(); turnStarts.set(params.turn.id, (params.turn.startedAt ?? thread.createdAt) * 1000); emit('session.status', thread, { ...sessionData(thread.id), status: { type: 'busy' } }); return; }
    if (method === 'item/started') { startItem(thread, { item: params.item, turnId: params.turnId, startedAtMs: params.startedAtMs }); if (params.item.type === 'subAgentActivity' && params.item.kind === 'interacted' && !childIdsOf(thread, params.item).size) void recoverLiveCommunications(thread); return; }
    if (method === 'item/completed') { finishItem(thread, { item: params.item, turnId: params.turnId, startedAtMs: params.startedAtMs, completedAtMs: params.completedAtMs }); if (params.item.type === 'subAgentActivity') void recoverLiveCommunications(thread); return; }
    if (method === 'item/agentMessage/delta' || method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
      let tracked = items.get(params.itemId);
      const reasoning = method.includes('reasoning');
      if (!tracked) { startItem(thread, { item: reasoning ? { id: params.itemId, type: 'reasoning', summary: [], content: [] } : { id: params.itemId, type: 'agentMessage', text: '' }, turnId: params.turnId }); tracked = items.get(params.itemId); }
      if (tracked) {
        tracked.content.text += params.delta;
        if (reasoning) tracked.item.summary = [tracked.content.text]; else tracked.item.text = tracked.content.text;
        emit(`session.${reasoning ? 'reasoning' : 'text'}.delta`, thread, { ...sessionData(thread.id), assistantMessageID: tracked.messageID, ordinal: 0, delta: params.delta });
      }
      return;
    }
    if (method === 'item/commandExecution/outputDelta') {
      const tracked = items.get(params.itemId);
      if (tracked) { tracked.item.aggregatedOutput = (tracked.item.aggregatedOutput || '') + params.delta; emit('session.tool.progress', thread, { ...sessionData(thread.id), assistantMessageID: tracked.messageID, id: params.itemId, metadata: { output: tracked.item.aggregatedOutput } }); }
      return;
    }
    if (method === 'turn/completed') {
      void recoverLiveCommunications(thread);
      const status = params.turn.status;
      for (const entry of [...items.values()]) if (entry.threadId === thread.id) finishItem(thread, { ...entry, completedAtMs: Date.now() }, status === 'failed' ? 'error' : status === 'interrupted' ? 'interrupted' : 'stop');
      const lastAssistant = turnLastAssistant.get(params.turn.id);
      if (lastAssistant && turnUsage.has(params.turn.id)) emit('session.step.ended', thread, { ...sessionData(thread.id), assistantMessageID: lastAssistant, finish: status === 'failed' ? 'error' : 'stop', cost: 0, tokens: tokensOf(turnUsage.get(params.turn.id)), metadata: { codex: { usageAvailable: true, usageScope: 'turn' } } });
      turnUsage.delete(params.turn.id);
      turnBaselines.delete(params.turn.id);
      turnLastAssistant.delete(params.turn.id);
      activeTurns.delete(thread.id);
      turnStarts.delete(params.turn.id);
      for (const [id, entry] of [...pending]) if (entry.threadId === thread.id) settle(id, entry.kind === 'permission' ? { decision: 'decline' } : { answers: {} }, true);
      if (status === 'failed') emit('session.execution.failed', thread, { ...sessionData(thread.id), error: { type: 'CodexError', message: params.turn.error?.message || 'Codex turn failed' } });
      emit('session.status', thread, { ...sessionData(thread.id), status: { type: 'idle' } });
      emit('session.idle', thread, sessionData(thread.id));
    }
  }
  const recoverLiveCommunications = async (thread) => {
    if (!subscribed.has(thread.id)) return;
    const running = communicationReads.get(thread.id);
    if (running) { running.dirty = true; return running.promise; }
    const work = { dirty: true, promise: null };
    const task = (async () => {
      try {
        do {
        work.dirty = false;
        const entries = await communications.read(thread);
        let sent = sentCommunications.get(thread.id);
        if (!sent) { sent = new Map(); sentCommunications.set(thread.id, sent); }
        for (const entry of entries) {
          const done = entry.completedAtMs !== null;
          if (!sent.has(entry.item.id)) startItem(thread, entry);
          if (done && sent.get(entry.item.id) !== true) finishItem(thread, entry);
          sent.set(entry.item.id, done);
        }
        } while (work.dirty);
      } catch (error) { console.warn('[codex] Communication recovery failed:', error.message); }
    })().finally(() => communicationReads.delete(thread.id));
    work.promise = task;
    communicationReads.set(thread.id, work);
    return task;
  };
  const read = async (id) => fresh.has(id) ? threadOf(id) : remember((await rpc.request('thread/read', { threadId: id })).thread);
  const hydrateContext = async (thread) => {
    await communications.read(thread);
    const latestUsage = [...(communications.cumulativeUsage?.(thread.id)?.values() || [])].at(-1);
    if (latestUsage) threadUsage.set(thread.id, latestUsage);
    const context = communications.context?.(thread.id);
    if (context) { thread.context = context; thread.contextWindow = context.window; }
    return thread;
  };
  const hydrateChildren = async (id) => {
    for (const archived of [false, true]) (await pages('thread/list', { parentThreadId: id, archived, sourceKinds: ['subAgent', 'subAgentThreadSpawn'], modelProviders: [], useStateDbOnly: true })).forEach(remember);
  };
  const messages = async (id) => {
    const revision = chronology.get(id)?.revision ?? 0;
    const thread = await read(id);
    if (fresh.has(id)) return [];
    const turns = z.array(turnSchema).parse(await pages('thread/turns/list', { threadId: id, sortDirection: 'asc', itemsView: 'summary' }));
    const entries = z.array(itemEntrySchema).parse(await pages('thread/items/list', { threadId: id, sortDirection: 'asc' }));
    const recovered = await communications.read(thread);
    const byId = new Map(recovered.map((entry) => [entry.item.id, entry]));
    for (const entry of entries) {
      const supplement = byId.get(entry.item.id);
      if (!supplement) continue;
      if (entry.item.type === 'subAgentActivity') Object.assign(entry, supplement);
      else if (entry.item.type === 'collabAgentToolCall' && !entry.item.prompt) entry.item = { ...entry.item, prompt: supplement.item.prompt, description: supplement.item.description };
      byId.delete(entry.item.id);
    }
    const missing = [...byId.values()];
    if (missing.length) {
      const turnOrder = new Map(turns.map((turn, index) => [turn.id, index]));
      const tagged = entries.map((entry, index) => ({ entry, index }));
      for (const entry of missing) if (turnOrder.has(entry.turnId)) {
        let index = entries.findIndex((native) => native.turnId === entry.turnId && native.item.type !== 'userMessage' && native.startedAtMs !== null && native.startedAtMs > entry.startedAtMs);
        if (index < 0) index = entries.length;
        tagged.push({ entry, index: index - 0.5 });
      }
      tagged.sort((left, right) => (turnOrder.get(left.entry.turnId) - turnOrder.get(right.entry.turnId)) || left.index - right.index || left.entry.startedAtMs - right.entry.startedAtMs);
      entries.splice(0, entries.length, ...tagged.map(({ entry }) => entry));
    }
    rememberCommunications(id, recovered);
    const recipients = new Set(entries.flatMap(({ item }) => item.type === 'subAgentActivity' ? [item.agentThreadId] : item.type === 'collabAgentToolCall' ? item.receiverThreadIds || [] : []));
    for (const recipient of recipients) if (recipient !== id && recipient !== parentThreadIdOf(thread) && !threads.has(recipient) && z.uuid().safeParse(recipient).success) {
      try { await read(recipient); } catch { /* Missing recipients cannot grant child-task semantics. */ }
    }
    const turnById = new Map(turns.map((turn) => [turn.id, turn]));
    const lastTurnId = turns.at(-1)?.id;
    const lastTurnTimes = new Map();
    const accounted = communications.usage?.(id) || new Map();
    const contextByTurn = communications.contextByTurn?.(id) || new Map();
    const currentContext = communications.context?.(id);
    if (currentContext) { thread.context = currentContext; thread.contextWindow = currentContext.window; }
    const cumulative = communications.cumulativeUsage?.(id) || new Map();
    const latestUsage = [...cumulative.values()].at(-1);
    if (latestUsage) threadUsage.set(id, latestUsage);
    let previous = -1;
    const result = [];
    for (const entry of entries) {
        const turn = turnById.get(entry.turnId);
        if (!turn) throw new Error('Codex returned an item outside its turn history');
        const item = entry.item;
        const state = chronology.get(id);
        const newerLiveTime = state && (state.revision !== revision || entry.startedAtMs === null) ? state.times.get(item.id) : undefined;
        const created = Math.max(newerLiveTime ?? entry.startedAtMs ?? (turn.startedAt ?? thread.createdAt) * 1000, previous + 1);
        previous = created;
        if (entry.turnId === lastTurnId) lastTurnTimes.set(item.id, created);
        const message = toMessage({ ...entry, createdAtMs: created }, thread, turn, childIdsOf(thread, item));
        if (message) result.push(message);
    }
    const state = chronology.get(id);
    if (state) {
      for (const [itemId, created] of state.times) if (state.revision !== revision || !lastTurnTimes.has(itemId)) lastTurnTimes.set(itemId, created);
      state.times = lastTurnTimes;
      state.last = Math.max(state.last, previous);
    } else chronology.set(id, { times: lastTurnTimes, last: previous, revision: 0 });
    const lastByTurn = new Map();
    const renderedAssistantIds = new Set(result.filter((entry) => entry.type === 'assistant').map((entry) => entry.id));
    for (const entry of entries) { const id = messageId(entry.item.clientId || entry.item.id); if (renderedAssistantIds.has(id)) lastByTurn.set(entry.turnId, id); }
    for (const [turnId, messageID] of lastByTurn) {
      const message = result.find((entry) => entry.id === messageID && entry.type === 'assistant');
      if (message && accounted.has(turnId)) {
        message.tokens = tokensOf(accounted.get(turnId));
        const total = cumulative.get(turnId);
        message.metadata = { ...message.metadata, codex: { ...message.metadata?.codex, usageAvailable: true, usageScope: 'turn', cumulativeTokens: total ? total.inputTokens + total.outputTokens : null } };
        if (contextByTurn.has(turnId)) message.metadata.codex.context = contextByTurn.get(turnId);
      }
    }
    return result;
  };
  return {
    ensureAvailable: rpc.ensureAvailable, emit,
    read: async (id) => hydrateContext(await read(id)),
    list: async (options = {}) => {
      const request = { archived: options.archived || false, searchTerm: options.search || null, modelProviders: [], useStateDbOnly: true, sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'subAgent', 'subAgentReview', 'subAgentCompact', 'subAgentThreadSpawn', 'subAgentOther', 'unknown'] };
      if (options.parentId) request.parentThreadId = options.parentId;
      const listed = (await pages('thread/list', request)).map(remember).filter((thread) => !options.parentId || parentThreadIdOf(thread) === options.parentId);
      const seen = new Set(listed.map((thread) => thread.id));
      if (!options.parentId) {
        // Global Codex lists omit some empty-preview workers. Parent queries
        // classify their archive/search state without reading transcripts.
        const loaded = z.array(z.uuid()).parse(await pages('thread/loaded/list'));
        const missing = new Map();
        for (const id of loaded) {
          if (seen.has(id) || fresh.has(id)) continue;
          const child = await read(id);
          const parentId = parentThreadIdOf(child);
          if (parentId) missing.set(id, parentId);
        }
        for (const parentId of new Set(missing.values())) {
          const children = (await pages('thread/list', { ...request, parentThreadId: parentId })).map(remember);
          for (const child of children) {
            if (missing.get(child.id) !== parentId || parentThreadIdOf(child) !== parentId || seen.has(child.id)) continue;
            listed.push(child);
            seen.add(child.id);
          }
        }
      }
      if (!options.archived) for (const id of fresh) { const thread = threadOf(id); if (!seen.has(id) && (!options.parentId || parentThreadIdOf(thread) === options.parentId) && (!options.search || (thread.name || '').toLowerCase().includes(options.search.toLowerCase()))) listed.push(thread); }
      return listed;
    },
    active: async (directory) => {
      const ids = await pages('thread/loaded/list');
      const result = {};
      for (const id of ids) { const thread = await read(id); if ((!directory || thread.cwd === directory || thread.cwd.startsWith(`${directory}/`)) && thread.status?.type === 'active') result[toPublicId(id)] = { type: 'busy' }; }
      return result;
    },
    messages,
    models: () => pages('model/list', { includeHidden: false }),
    defaults: async (directory) => {
      const request = { includeLayers: false };
      if (directory) request.cwd = directory;
      const result = await rpc.request('config/read', request);
      const config = z.object({ model: z.string().nullable().optional(), model_reasoning_effort: z.string().nullable().optional() }).parse(result.config);
      return { model: config.model || null, effort: config.model_reasoning_effort || null };
    },
    create: async ({ directory, model, mode = 'full-access', effort }) => { const thread = rememberResponse(await rpc.request('thread/start', { cwd: directory, model, ...modeSettings(mode), config: effort ? { model_reasoning_effort: effort } : undefined })); fresh.add(thread.id); return thread; },
    resume: async (id, selection = {}) => {
      if (fresh.has(id)) { subscribed.add(id); return threadOf(id); }
      if (selection.model || selection.mode || selection.effort) {
        const current = await read(id);
        if (current.status.type === 'active' || starting.has(id)) throw Object.assign(new Error('Codex session is busy'), { status: 409 });
      }
      const request = { threadId: id, excludeTurns: true };
      if (selection.model) request.model = selection.model;
      if (selection.mode) Object.assign(request, modeSettings(selection.mode));
      if (selection.effort) request.config = { model_reasoning_effort: selection.effort };
      const resumed = rememberResponse(await rpc.request('thread/resume', request));
      await hydrateChildren(id);
      subscribed.add(id);
      try {
        const existing = await communications.read(resumed);
        const latestUsage = [...(communications.cumulativeUsage?.(id)?.values() || [])].at(-1);
        if (latestUsage) threadUsage.set(id, latestUsage);
        const context = communications.context?.(id);
        if (context) { resumed.context = context; resumed.contextWindow = context.window; }
        rememberCommunications(id, existing);
      } catch (error) { console.warn('[codex] Communication recovery failed:', error.message); }
      return resumed;
    },
    prompt: async (id, { text, files = [], context = [], selection = {}, clientId, delivery = 'queue' }) => {
      subscribed.add(id);
      if (starting.has(id)) throw Object.assign(new Error('Codex session is busy'), { status: 409 });
      starting.add(id);
      try {
      const input = [...context, text].filter(Boolean).map((value) => ({ type: 'text', text: value, text_elements: [] }));
      for (const file of files) input.push(imageInput(file));
      if (!input.length) throw Object.assign(new Error('Prompt is empty'), { status: 400 });
      const current = await read(id);
      if (current.status.type === 'active') {
        if (delivery !== 'steer') throw Object.assign(new Error('Codex session is busy'), { status: 409 });
        let turnId = activeTurns.get(id);
        if (!turnId) { const turns = await pages('thread/turns/list', { threadId: id }); turnId = turns.find((turn) => turn.status === 'inProgress')?.id; }
        if (!turnId) throw Object.assign(new Error('Active Codex turn could not be identified'), { status: 409 });
        const request = { threadId: id, input, expectedTurnId: turnId };
        if (clientId) request.clientUserMessageId = clientId;
        await rpc.request('turn/steer', request);
        return { messageID: messageId(clientId || turnId), created: Date.now() };
      }
      if (!fresh.has(id) && !chronology.has(id)) await messages(id);
      const resume = { threadId: id, excludeTurns: true };
      if (selection.mode) Object.assign(resume, modeSettings(selection.mode));
      if (selection.model) resume.model = selection.model;
      if (!fresh.has(id)) { await rpc.request('thread/resume', resume).then(rememberResponse); await hydrateChildren(id); }
      const request = { threadId: id, input };
      if (selection.mode) {
        const mode = selection.mode;
        request.approvalPolicy = modeSettings(mode).approvalPolicy;
        request.sandboxPolicy = mode === 'full-access' ? { type: 'dangerFullAccess' } : mode === 'workspace-write' ? { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true } : { type: 'readOnly', networkAccess: false };
      }
      if (clientId) request.clientUserMessageId = clientId;
      if (selection.model) request.model = selection.model;
      if (selection.effort) request.effort = selection.effort;
      const result = await rpc.request('turn/start', request);
      fresh.delete(id);
      activeTurns.set(id, result.turn.id);
      return { messageID: messageId(clientId || result.turn.id), created: Date.now() };
      } finally { starting.delete(id); }
    },
    interrupt: async (id) => { const thread = await read(id); if (thread.status?.type !== 'active') return false; let turnId = activeTurns.get(id); if (!turnId) { const turns = await pages('thread/turns/list', { threadId: id }); turnId = turns.find((turn) => turn.status === 'inProgress')?.id; } if (!turnId) throw new Error('Active Codex turn could not be identified'); await rpc.request('turn/interrupt', { threadId: id, turnId }); return true; },
    rename: (id, name) => rpc.request('thread/name/set', { threadId: id, name }),
    archive: (id, archived) => rpc.request(archived ? 'thread/archive' : 'thread/unarchive', { threadId: id }),
    delete: async (id) => { if (fresh.has(id)) { await rpc.request('thread/unsubscribe', { threadId: id }); fresh.delete(id); threads.delete(id); return; } await rpc.request('thread/delete', { threadId: id }); },
    compact: async (id) => { await rpc.request('thread/resume', { threadId: id, excludeTurns: true }).then((response) => remember(response.thread)); return rpc.request('thread/compact/start', { threadId: id }); },
    fork: async (id) => remember((await rpc.request('thread/fork', { threadId: id, excludeTurns: true })).thread),
    pending: (kind, { directory, id } = {}) => [...pending.values()].filter((entry) => entry.kind === kind && (!id || entry.threadId === id) && (!directory || threadOf(entry.threadId).cwd === directory || threadOf(entry.threadId).cwd.startsWith(`${directory}/`))).map((entry) => entry.request),
    replyPermission: (threadId, id, decision) => { const entry = pending.get(id); if (entry?.threadId !== threadId || entry.kind !== 'permission') return false; return settle(id, { decision: !isAllowed() ? 'decline' : decision === 'once' ? 'accept' : decision === 'always' ? 'acceptForSession' : 'decline' }); },
    replyForm: (threadId, id, answer) => { const entry = pending.get(id); if (entry?.threadId !== threadId || entry.kind !== 'form') return false; const answers = {}; for (const question of entry.params.questions || []) { const parsed = answerSchema.safeParse(answer[question.id]); if (!parsed.success) throw Object.assign(new Error('Invalid Codex question answer'), { status: 400 }); answers[question.id] = { answers: Array.isArray(parsed.data) ? parsed.data : [parsed.data] }; } return settle(id, { answers }); },
    cancelForm: (threadId, id) => pending.get(id)?.threadId === threadId && settle(id, { answers: {} }, true),
    denyPending: () => { for (const [id, entry] of [...pending]) settle(id, entry.kind === 'permission' ? { decision: 'decline' } : { answers: {} }, true); },
    dispose: async () => { try { for (const [id, entry] of [...pending]) settle(id, entry.kind === 'permission' ? { decision: 'decline' } : { answers: {} }, true); } finally { communications.dispose(); await rpc.dispose(); } },
  };
};
