import { randomUUID } from 'node:crypto';
import { isEnterpriseMode } from '../enterprise-mode.js';
import { pageOf } from '../claude/v2-wire.js';
import { CODEX_MODES, createCodexRuntime } from './runtime.js';
import { fromPublicId, isCodexSessionId, toPublicId, toSession } from './wire.js';
import { z } from 'zod';
import { sendUnsupportedOperation } from '../engines/engines.js';

export { isCodexSessionId } from './wire.js';

const fail = (res, status, message, extra = {}) => res.status(status).json({ _tag: status === 400 ? 'InvalidRequestError' : status === 404 ? 'SessionNotFoundError' : 'UnknownError', message, ...extra });
const unsupported = (res, operation) => sendUnsupportedOperation(res, 'codex', operation);
const bodySchema = z.record(z.string(), z.json());
const textSchema = z.string();
const objectBody = (body) => bodySchema.safeParse(body).success;
const MAX_BODY = 8 * 1024 * 1024;

/** Preserve a declined request's payload for the following engine/proxy. */
const readJsonBody = async (req) => {
  if (req.body !== undefined) {
    if (!objectBody(req.body)) throw Object.assign(new Error('Expected a JSON object'), { status: 400 });
    if (Buffer.byteLength(JSON.stringify(req.body)) > MAX_BODY) throw Object.assign(new Error('Request body is too large'), { status: 413 });
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY) { req.body = Buffer.concat(chunks); throw Object.assign(new Error('Request body is too large'), { status: 413 }); }
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks);
  req.body = raw;
  if (!raw.length) { req.body = {}; return req.body; }
  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON request'), { status: 400 }); }
  if (!objectBody(body)) throw Object.assign(new Error('Expected a JSON object'), { status: 400 });
  req.body = body;
  return body;
};

const directoryOf = (req) => {
  const query = textSchema.safeParse(req.query?.directory);
  if (query.success) return query.data;
  const directory = req.get?.('x-opencode-directory');
  if (!directory) return undefined;
  try { return decodeURIComponent(directory); } catch { throw Object.assign(new Error('Invalid directory header'), { status: 400 }); }
};
const inDirectory = (thread, directory) => !directory || thread.cwd === directory || thread.cwd.startsWith(`${directory.replace(/\/$/, '')}/`);
const createdEvent = (session) => ({ sessionID: session.id, projectID: session.projectID, location: session.location, subpath: session.subpath, parentID: session.parentID, slug: `codex-${session.id.slice(-8)}`, title: session.title, agent: session.agent, model: session.model, metadata: session.metadata, version: '2' });

export const createCodexSurface = (dependencies = {}) => {
  const env = dependencies.env || process.env;
  const enterprise = dependencies.isEnterpriseMode || isEnterpriseMode;
  const disabled = () => env.OPENCHAMBER_CODEX_DISABLED === '1';
  const allowed = () => !disabled() && !enterprise();
  const assertAllowed = () => { if (!allowed()) { runtime.denyPending?.(); throw Object.assign(new Error(enterprise() ? 'Codex is disabled in enterprise mode' : 'Codex is disabled'), { status: 403, code: enterprise() ? 'enterprise_mode' : 'codex_disabled' }); } };
  // Events and server requests must respect policy changes after connection.
  const runtime = dependencies.runtime || createCodexRuntime({ ...dependencies, env, isAllowed: allowed, toWireSession: (thread) => wireSession(thread), publishEvent: (event) => { if (allowed()) dependencies.publishEvent?.(event); } });
  const selections = new Map();
  const context = new Map();
  const instructions = new Map();
  let projects = [];
  let archived = {};
  const refresh = async () => {
    if (dependencies.readProjects) projects = await dependencies.readProjects();
    if (dependencies.getArchivedSessions) archived = await dependencies.getArchivedSessions() || {};
    if (dependencies.getStoredMetadata) await dependencies.getStoredMetadata('');
  };
  const selectionOf = async (id) => {
    const stored = dependencies.getStoredMetadata ? await dependencies.getStoredMetadata(toPublicId(id)) : undefined;
    return { ...stored?.codex, ...selections.get(id) };
  };
  const wireSession = (thread, archiveTime) => {
    const project = projects.filter((entry) => entry.worktree !== '/' && inDirectory(thread, entry.worktree)).sort((a, b) => b.worktree.length - a.worktree.length)[0];
    return toSession(thread, { project, metadata: dependencies.peekStoredMetadata?.(toPublicId(thread.id)), selection: selections.get(thread.id), archivedAt: archived[toPublicId(thread.id)] || archiveTime });
  };
  const announceSession = async (publicId) => {
    const id = fromPublicId(publicId);
    if (!id || !allowed()) return;
    await refresh();
    const thread = await runtime.read(id);
    const session = wireSession(thread);
    runtime.emit('session.renamed', thread, { sessionID: session.id, title: session.title });
    runtime.emit('session.metadata.updated', thread, { sessionID: session.id, metadata: session.metadata });
  };
  const listCodexSessions = async ({ directory, search } = {}) => {
    if (!allowed()) { runtime.denyPending?.(); return []; }
    if (!await runtime.ensureAvailable()) return [];
    await refresh();
    const [current, history] = await Promise.all([runtime.list({ search }), runtime.list({ archived: true, search })]);
    return [...current.map((thread) => wireSession(thread)), ...history.map((thread) => wireSession(thread, thread.updatedAt * 1000))].filter((session) => !directory || session.metadata.codex.directory === directory || session.metadata.codex.directory.startsWith(`${directory.replace(/\/$/, '')}/`));
  };
  const listCodexActive = async ({ directory } = {}) => {
    if (!allowed()) { runtime.denyPending?.(); return {}; }
    if (!await runtime.ensureAvailable()) return {};
    return runtime.active(directory);
  };
  const listCodexPending = (kind, { directory } = {}) => { if (!allowed()) { runtime.denyPending?.(); return []; } return runtime.pending(kind, { directory }); };
  const begin = async (id, { text = '', files = [], context: extra = [], knowledge = '', clientId, sendConfig, delivery } = {}) => {
    assertAllowed();
    const pending = context.get(id) || [];
    const captured = [...(knowledge ? [] : [...(instructions.get(id)?.values() || [])]), ...pending, ...extra, ...(knowledge ? [knowledge] : [])];
    context.delete(id);
    try {
      const selection = await selectionOf(id);
      if (sendConfig?.modelID) {
        if (sendConfig.providerID && sendConfig.providerID !== 'codex') throw new Error('A Codex session requires a Codex model');
        const catalog = await getCatalog();
        const chosen = catalog.models.find((model) => model.id === sendConfig.modelID);
        if (!chosen) throw new Error('Unknown queued Codex model');
        if (sendConfig.variant && !chosen.supportedReasoningEfforts.some((entry) => entry.reasoningEffort === sendConfig.variant)) throw new Error('Unsupported queued Codex effort');
        selection.model = chosen.id;
        selection.effort = sendConfig.variant || chosen.defaultReasoningEffort;
      }
      return await runtime.prompt(id, { text, files, context: captured, selection, clientId, delivery });
    }
    catch (error) { if (pending.length) context.set(id, [...pending, ...(context.get(id) || [])]); throw error; }
  };
  const queueTransport = {
    owns: isCodexSessionId,
    isIdle: async (publicId) => { if (!isCodexSessionId(publicId) || !allowed() || !await runtime.ensureAvailable()) return null; const snapshot = await runtime.active(); return !snapshot[publicId]; },
    send: async (publicId, directory, input = {}) => { const id = fromPublicId(publicId); if (!id) throw new Error('Not a Codex session'); await begin(id, input); return { knowledgeDelivered: Boolean(input.knowledge) }; },
  };
  const changeSelection = async (id, patch) => {
    assertAllowed();
    const selection = { ...await selectionOf(id), ...patch };
    await runtime.resume(id, selection);
    if (dependencies.updateStoredMetadata) await dependencies.updateStoredMetadata(toPublicId(id), { codex: selection });
    selections.set(id, selection);
    await announceSession(toPublicId(id));
  };
  const getCatalog = async (directory) => {
    const catalog = (await runtime.models()).filter((model) => !model.hidden);
    const native = runtime.defaults ? await runtime.defaults(directory) : {};
    const settings = dependencies.readAppSettings ? await dependencies.readAppSettings() : {};
    if (native.model && !catalog.some((model) => (model.model || model.id) === native.model)) catalog.push({ id: native.model, model: native.model, displayName: native.model, description: 'Configured in Codex', supportedReasoningEfforts: native.effort ? [{ reasoningEffort: native.effort }] : [], defaultReasoningEffort: native.effort || 'medium' });
    const models = catalog.map((model) => ({ id: model.model || model.id, label: model.displayName, description: model.description, supportedReasoningEfforts: model.supportedReasoningEfforts || [], defaultReasoningEffort: model.defaultReasoningEffort }));
    const preferred = catalog.find((model) => (model.model || model.id) === (settings.codexDefaultModel || native.model)) || catalog.find((model) => model.isDefault) || catalog[0];
    const defaultModel = preferred?.model || preferred?.id || native.model || '';
    const supported = preferred?.supportedReasoningEfforts || [];
    const requestedEffort = settings.codexDefaultEffort || native.effort;
    const defaultEffort = supported.some((entry) => entry.reasoningEffort === requestedEffort) ? requestedEffort : preferred?.defaultReasoningEffort || 'medium';
    const defaultMode = CODEX_MODES.some((entry) => entry.id === settings.codexDefaultMode) ? settings.codexDefaultMode : 'full-access';
    const efforts = [...new Set(models.flatMap((model) => model.supportedReasoningEfforts.map((entry) => entry.reasoningEffort)))].map((id) => ({ id, label: id }));
    return { models, defaultModel, defaultModelId: defaultModel, efforts, defaultEffort, modes: CODEX_MODES, defaultMode };
  };
  const archiveSession = async (publicId, archive) => {
    assertAllowed();
    const id = fromPublicId(publicId);
    if (!id) throw new Error('Not a Codex session');
    await runtime.archive(id, archive);
  };
  const register = (app) => {
    const route = (method, path, handler) => app[method](path, async (req, res, next) => {
      const id = req.params?.id ? fromPublicId(req.params.id) : null;
      if (req.params?.id && !id) return next();
      try { assertAllowed(); return await handler(req, res, id, next); }
      catch (error) { return fail(res, error.status || (error.code === 'CODEX_UNAVAILABLE' ? 503 : 502), error.message || 'Codex request failed', error.code ? { code: error.code } : {}); }
    });
    app.get('/api/session', async (req, res, next) => {
      const parentId = fromPublicId(req.query?.parentID);
      if (!parentId) return next();
      try {
        assertAllowed();
        await refresh();
        const [active, history] = await Promise.all([runtime.list({ parentId }), runtime.list({ parentId, archived: true })]);
        const sessions = [...active.map((thread) => wireSession(thread)), ...history.map((thread) => wireSession(thread, thread.updatedAt * 1000))];
        sessions.sort((left, right) => left.time.created - right.time.created || left.id.localeCompare(right.id));
        const page = pageOf(sessions, { limit: Math.min(1000, Math.max(1, Number(req.query?.limit) || 100)), order: req.query?.order, cursor: req.query?.cursor });
        return page ? res.json(page) : fail(res, 400, 'Invalid cursor');
      } catch (error) { return fail(res, error.status || 502, error.message); }
    });
    route('get', '/api/codex/models', async (req, res) => {
      return res.json(await getCatalog(directoryOf(req)));
    });
    // Creation must inspect the body before deciding which engine owns it.
    app.post('/api/session', async (req, res, next) => {
      let body;
      try { body = await readJsonBody(req); } catch (error) { return fail(res, error.status || 400, error.message); }
      if (body.metadata?.backend !== 'codex' && body.agent !== 'codex') return next();
      try {
        assertAllowed();
        const directory = body.location?.directory || body.directory || directoryOf(req);
        if (!z.string().min(1).max(32_768).safeParse(directory).success) return fail(res, 400, 'A working directory is required');
        const defaults = await getCatalog(directory);
        const model = (body.model?.providerID === 'codex' ? body.model.id : body.metadata?.codex?.model) || defaults.defaultModelId;
        const effort = body.model?.variant || body.metadata?.codex?.effort || defaults.defaultEffort;
        const mode = body.metadata?.codex?.mode || defaults.defaultMode;
        const selected = defaults.models.find((entry) => entry.id === model);
        if (selected && !selected.supportedReasoningEfforts.some((entry) => entry.reasoningEffort === effort)) return fail(res, 400, 'Unsupported reasoning effort');
        if (!CODEX_MODES.some((entry) => entry.id === mode)) return fail(res, 400, 'Unknown Codex mode');
        const thread = await runtime.create({ directory, model, effort, mode });
        const selection = { mode };
        if (model) selection.model = model;
        if (effort) selection.effort = effort;
        selections.set(thread.id, selection);
        if (dependencies.updateStoredMetadata) await dependencies.updateStoredMetadata(toPublicId(thread.id), { codex: selection });
        await refresh();
        const session = wireSession(thread);
        runtime.emit('session.created', thread, createdEvent(session));
        return res.json({ data: session });
      } catch (error) { return fail(res, error.status || 502, error.message, error.code ? { code: error.code } : {}); }
    });
    route('get', '/api/session/:id', async (req, res, id) => { const thread = await runtime.resume(id); await refresh(); return res.json({ data: wireSession(thread) }); });
    route('get', '/api/session/:id/message', async (req, res, id) => {
      const parsedTypes = textSchema.safeParse(req.query?.type);
      const types = parsedTypes.success ? parsedTypes.data.split(',') : null;
      const messages = await runtime.messages(id);
      const page = pageOf(types ? messages.filter((message) => types.includes(message.type)) : messages, { limit: Math.min(1000, Math.max(1, Number(req.query?.limit) || 100)), order: req.query?.order, cursor: req.query?.cursor });
      return page ? res.json(page) : fail(res, 400, 'Invalid cursor');
    });
    route('get', '/api/session/:id/message/:messageID', async (req, res, id) => { const message = (await runtime.messages(id)).find((entry) => entry.id === req.params.messageID); return message ? res.json({ data: message }) : fail(res, 404, 'Message not found'); });
    route('post', '/api/session/:id/model', async (req, res, id) => {
      const body = await readJsonBody(req);
      const model = body.model || body;
      // Shared composer may send its OpenCode selection before a native prompt.
      if (model.providerID && model.providerID !== 'codex') return res.status(204).end();
      const modelId = model.id || model.modelID;
      if (!z.string().min(1).max(256).safeParse(modelId).success) return fail(res, 400, 'A Codex model is required');
      const catalog = await runtime.models();
      const chosen = catalog.find((entry) => (entry.model || entry.id) === modelId && !entry.hidden);
      if (!chosen) return fail(res, 400, 'Unknown Codex model');
      const effort = model.variant || body.effort;
      if (effort && !chosen.supportedReasoningEfforts?.some((entry) => entry.reasoningEffort === effort)) return fail(res, 400, 'Unsupported reasoning effort');
      await changeSelection(id, { model: modelId, effort: effort || chosen.defaultReasoningEffort });
      return res.status(204).end();
    });
    const modeHandler = async (req, res, id) => { const body = await readJsonBody(req); if (!CODEX_MODES.some((entry) => entry.id === body.mode)) return fail(res, 400, 'Unknown Codex mode'); await changeSelection(id, { mode: body.mode }); return res.json({ mode: body.mode }); };
    route('post', '/api/session/:id/codex/mode', modeHandler);
    route('post', '/api/session/:id/mode', modeHandler);
    route('post', '/api/session/:id/agent', async (req, res) => { await readJsonBody(req); return res.status(204).end(); });
    route('post', '/api/session/:id/prompt', async (req, res, id) => {
      const body = await readJsonBody(req);
      if (body.text !== undefined && !textSchema.safeParse(body.text).success) return fail(res, 400, 'Prompt text must be a string');
      if (body.files !== undefined && !Array.isArray(body.files)) return fail(res, 400, 'Prompt files must be an array');
      const parsedId = z.string().max(256).regex(/^msg_/).safeParse(body.id);
      const clientId = parsedId.success ? parsedId.data : `msg_cdx${randomUUID().replaceAll('-', '')}`;
      const turn = await begin(id, { text: body.text, files: body.files, clientId, delivery: body.delivery });
      const payload = { text: body.text || '' };
      if (body.files?.length) payload.files = body.files;
      return res.json({ data: { id: turn.messageID, sessionID: req.params.id, time: { created: turn.created }, type: 'user', payload, delivery: body.delivery || 'queue' } });
    });
    route('post', '/api/session/:id/synthetic', async (req, res, id) => {
      const body = await readJsonBody(req);
      if (!textSchema.safeParse(body.text).success) return fail(res, 400, 'Context text must be a string');
      const entries = context.get(id) || [];
      if (entries.join('').length + body.text.length > MAX_BODY) return fail(res, 413, 'Pending context is too large');
      context.set(id, [...entries, body.text]);
      return res.json({ data: { id: body.id || `msg_cdx${randomUUID().replaceAll('-', '')}`, sessionID: req.params.id, type: 'synthetic', time: { created: Date.now() }, payload: { text: body.text }, delivery: 'queue' } });
    });
    route('post', '/api/session/:id/interrupt', async (req, res, id) => res.json({ interrupted: await runtime.interrupt(id) }));
    route('post', '/api/session/:id/compact', async (req, res, id) => { await readJsonBody(req); await runtime.compact(id); return res.status(204).end(); });
    route('post', '/api/session/:id/fork', async (req, res, id) => { const body = await readJsonBody(req); if (body.before || body.messageID) return unsupported(res, 'forkAtMessage'); const thread = await runtime.fork(id); await refresh(); const session = wireSession(thread); runtime.emit('session.created', thread, createdEvent(session)); return res.json({ data: session }); });
    route('patch', '/api/session/:id', async (req, res, id) => {
      const body = await readJsonBody(req);
      if (body.title !== undefined) { if (!z.string().trim().min(1).max(1024).safeParse(body.title).success) return fail(res, 400, 'Invalid session title'); await runtime.rename(id, body.title); }
      if (body.time && Object.hasOwn(body.time, 'archived')) await runtime.archive(id, Boolean(body.time.archived));
      await announceSession(req.params.id);
      return res.status(204).end();
    });
    route('delete', '/api/session/:id', async (req, res, id) => { await runtime.delete(id); context.delete(id); selections.delete(id); await dependencies.forgetStoredMetadata?.(req.params.id); runtime.emit('session.deleted', null, { sessionID: req.params.id }); return res.status(204).end(); });
    for (const kind of ['permission', 'form']) {
      route('get', `/api/session/:id/${kind}`, async (req, res, id) => res.json({ data: runtime.pending(kind, { id }) }));
      route('get', `/api/session/:id/${kind}/:requestID`, async (req, res, id) => { const request = runtime.pending(kind, { id }).find((entry) => entry.id === req.params.requestID); return request ? res.json({ data: request }) : fail(res, 404, 'Request not found'); });
      route('post', `/api/session/:id/${kind}/:requestID/reply`, async (req, res, id) => {
        const body = await readJsonBody(req);
        let answered;
        if (kind === 'permission') { const decision = body.decision || body.reply; if (!['once', 'always', 'reject'].includes(decision)) return fail(res, 400, 'Invalid approval decision'); answered = runtime.replyPermission(id, req.params.requestID, decision); }
        else { if (!objectBody(body.answer)) return fail(res, 400, 'Answer must be an object'); answered = runtime.replyForm(id, req.params.requestID, body.answer); }
        return answered ? res.status(204).end() : fail(res, 404, 'Request not found');
      });
    }
    route('delete', '/api/session/:id/form/:requestID', async (req, res, id) => runtime.cancelForm(id, req.params.requestID) ? res.status(204).end() : fail(res, 404, 'Request not found'));
    route('all', '/api/session/:id/*rest', async (req, res) => {
      const rest = Array.isArray(req.params.rest) ? req.params.rest.join('/') : String(req.params.rest || '');
      if (req.method === 'POST' && rest === 'view') return res.status(204).end();
      if (req.method === 'GET' && rest === 'inbox') return res.json({ data: [] });
      return unsupported(res, rest);
    });
    return runtime;
  };
  const sessionClient = {
    prompt: (publicId, body) => begin(fromPublicId(publicId), { text: body.text || '', files: body.files || [] }),
    activity: async (publicId) => { assertAllowed(); return { statuses: await listCodexActive(), children: (await runtime.list({ parentId: fromPublicId(publicId) })).map((thread) => ({ id: toPublicId(thread.id), parentID: publicId })) }; },
    get: async (publicId) => { const id = fromPublicId(publicId); assertAllowed(); await refresh(); return wireSession(await runtime.read(id)); },
    messages: async (publicId, options = {}) => {
      assertAllowed();
      const all = await runtime.messages(fromPublicId(publicId));
      const requested = options.type ? new Set(Array.isArray(options.type) ? options.type : String(options.type).split(',')) : null;
      const page = pageOf(requested ? all.filter((entry) => requested.has(entry.type)) : all, options);
      if (!page) throw new Error('Invalid native history cursor');
      return page;
    },
    synthetic: async (publicId, text) => { assertAllowed(); const id = fromPublicId(publicId); context.set(id, [...(context.get(id) || []), text]); },
    putInstruction: async (publicId, key, text) => { assertAllowed(); const id = fromPublicId(publicId); const values = instructions.get(id) || new Map(); values.set(key, text); instructions.set(id, values); },
    removeInstruction: async (publicId, key) => { assertAllowed(); instructions.get(fromPublicId(publicId))?.delete(key); },
  };
  return { register, getCatalog, sessionClient, listCodexSessions, listCodexActive, listCodexPending, runtime, announceSession, archiveSession, queueTransport, dispose: () => runtime.dispose() };
};
