import { describe, expect, it } from 'vitest';
import { createCodexRuntime } from './runtime.js';
import { toMessage, toPublicId, toSession } from './wire.js';
import { subagentSessionId } from '../../../../ui/src/lib/opencode/tools.ts';
import { translateWireEvent } from '../../../../ui/src/lib/opencode/events.ts';
import { sortMessagesChronologically } from '../../../../ui/src/sync/message-ordering.ts';
import { projectMessages } from '../../../../ui/src/lib/opencode/projection.ts';

const threadId = '019a1500-20c1-7000-9000-4296d2ff9517';
const thread = () => ({ id: threadId, cwd: '/repo', createdAt: 10, updatedAt: 20, model: 'gpt-test', reasoningEffort: 'medium', status: { type: 'idle' }, turns: [] });
const fixture = ({ handler, allowed = () => true, isAutoAccepting, evaluatePermission } = {}) => {
  const events = [];
  const calls = [];
  const responses = [];
  const errors = [];
  let callbacks;
  const runtime = createCodexRuntime({
    isAllowed: allowed,
    isAutoAccepting,
    evaluatePermission,
    publishEvent: ({ payload }) => events.push(payload),
    rpcFactory: (options) => {
      callbacks = options;
      return {
        ensureAvailable: async () => true,
        request: async (method, params) => { calls.push({ method, params }); if (handler) return handler(method, params); if (method === 'thread/read' || method === 'thread/resume') return { thread: thread() }; return { data: [], nextCursor: null }; },
        respond: (id, result) => responses.push({ id, result }),
        reject: (id, error) => errors.push({ id, error }),
        dispose: async () => {},
      };
    },
  });
  return { runtime, events, calls, responses, errors, notify: (method, params) => callbacks.onNotification(method, params), ask: (request) => callbacks.onRequest(request), disconnect: () => callbacks.onDisconnect() };
};

describe('Codex authority and lifecycle', () => {
  it('accounts every response once within a live turn while context remains the last request', async () => {
    const f = fixture();
    await f.runtime.read(threadId);
    const usage = (input, output, reasoning, cached = 0) => ({ inputTokens: input, outputTokens: output, reasoningOutputTokens: reasoning, cachedInputTokens: cached, totalTokens: input + output });
    const update = (turnId, total, last) => f.notify('thread/tokenUsage/updated', { threadId, turnId, tokenUsage: { total, last, modelContextWindow: 1000 } });
    const item = { type: 'agentMessage', id: 'answer', text: 'done' };
    f.notify('turn/started', { threadId, turn: { id: 't1' } });
    f.notify('item/started', { threadId, turnId: 't1', item, startedAtMs: 100 });
    update('t1', usage(100, 20, 5, 10), usage(100, 20, 5, 10));
    update('t1', usage(250, 50, 10, 30), usage(150, 30, 5, 20));
    update('t1', usage(250, 50, 10, 30), usage(150, 30, 5, 20));
    f.notify('turn/completed', { threadId, turn: { id: 't1', status: 'completed' } });
    const final = f.events.filter((event) => event.type === 'session.step.ended').at(-1);
    expect(final.data.tokens).toEqual({ input: 220, output: 50, reasoning: 10, cache: { read: 30, write: 0 } });
    expect(final.data.metadata.codex).toMatchObject({ usageAvailable: true, usageScope: 'turn' });
    expect(f.events.filter((event) => event.type === 'session.metadata.updated').at(-1).data.metadata.codex.context.tokens).toBe(180);
    f.notify('turn/started', { threadId, turn: { id: 't2' } });
    f.notify('item/started', { threadId, turnId: 't2', item: { ...item, id: 'answer2' }, startedAtMs: 200 });
    update('t2', usage(290, 60, 12, 35), usage(40, 10, 2, 5));
    f.notify('turn/completed', { threadId, turn: { id: 't2', status: 'completed' } });
    expect(f.events.filter((event) => event.type === 'session.step.ended').at(-1).data.tokens).toEqual({ input: 35, output: 10, reasoning: 2, cache: { read: 5, write: 0 } });
  });
  it('steers the authoritative active turn with text and images without changing its settings', async () => {
    const f = fixture({ handler: async (method) => {
      if (method === 'thread/read') return { thread: { ...thread(), status: { type: 'active' } } };
      if (method === 'thread/turns/list') return { data: [{ id: 'active-turn', status: 'inProgress' }], nextCursor: null };
      if (method === 'turn/steer') return { turnId: 'active-turn' };
      throw new Error('Unexpected mutation');
    } });
    await f.runtime.prompt(threadId, { text: 'change direction', files: [{ uri: 'data:image/png;base64,YQ==' }], clientId: 'msg_steer', delivery: 'steer', selection: { model: 'ignored', mode: 'full-access' } });
    expect(f.calls.at(-1)).toEqual({ method: 'turn/steer', params: { threadId, expectedTurnId: 'active-turn', clientUserMessageId: 'msg_steer', input: [{ type: 'text', text: 'change direction', text_elements: [] }, { type: 'image', url: 'data:image/png;base64,YQ==' }] } });
    expect(f.calls.some((call) => ['thread/resume', 'turn/start'].includes(call.method))).toBe(false);
  });
  it.each([
    ['readOnly', 'on-request', 'read-only'],
    ['workspaceWrite', 'on-request', 'workspace-write'],
    ['dangerFullAccess', 'never', 'full-access'],
    ['externalSandbox', 'never', null],
    ['dangerFullAccess', 'on-request', null],
  ])('reports effective %s/%s permissions without writing native overrides', async (sandbox, approvalPolicy, mode) => {
    const f = fixture({ handler: async (method) => method === 'thread/resume' ? { thread: thread(), sandbox: { type: sandbox }, approvalPolicy } : { data: [], nextCursor: null } });
    const resumed = await f.runtime.resume(threadId);
    expect(toSession(resumed).metadata.codex.mode).toBe(mode);
    expect(f.calls[0]).toEqual({ method: 'thread/resume', params: { threadId, excludeTurns: true } });
  });
  it('publishes the last native response context and window independently of accumulated usage', async () => {
    const f = fixture();
    await f.runtime.read(threadId);
    f.notify('thread/tokenUsage/updated', { threadId, turnId: 'turn', tokenUsage: { total: { totalTokens: 1900 }, last: { totalTokens: 100, inputTokens: 90, cachedInputTokens: 20, outputTokens: 10 }, modelContextWindow: 1000 } });
    const measured = f.events.find((event) => event.type === 'session.metadata.updated');
    expect(measured.data.metadata.codex).toMatchObject({ contextWindow: 1000, context: { state: 'measured', tokens: 100, window: 1000 } });
    f.notify('item/completed', { threadId, turnId: 'turn', item: { id: 'compact', type: 'contextCompaction' }, completedAtMs: 123 });
    expect(f.events.filter((event) => event.type === 'session.metadata.updated').at(-1).data.metadata.codex.context).toEqual({ state: 'compacted', window: 1000 });
    f.notify('thread/tokenUsage/updated', { threadId, turnId: 'next', tokenUsage: { total: { totalTokens: 2000 }, last: { totalTokens: 40 }, modelContextWindow: null } });
    expect(f.events.filter((event) => event.type === 'session.metadata.updated').at(-1).data.metadata.codex).toMatchObject({ contextWindow: null, context: { state: 'measured', tokens: 40, window: null } });
  });
  it('honors native session auto-accept while retaining held and unknown approvals', async () => {
    const auto = fixture({ isAutoAccepting: async () => true, evaluatePermission: async () => ({ action: 'allow' }) });
    await auto.runtime.read(threadId);
    auto.ask({ id: 1, method: 'item/commandExecution/requestApproval', params: { threadId, itemId: 'cmd', kind: 'command', command: 'pwd' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(auto.responses).toEqual([{ id: 1, result: { decision: 'accept' } }]);
    expect(auto.runtime.pending('permission')).toEqual([]);
    const held = fixture({ isAutoAccepting: async () => true, evaluatePermission: async () => ({ action: 'hold' }) });
    await held.runtime.read(threadId);
    held.ask({ id: 2, method: 'item/commandExecution/requestApproval', params: { threadId, itemId: 'cmd', kind: 'command' } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(held.responses).toEqual([]);
    expect(held.runtime.pending('permission')).toHaveLength(1);
    auto.ask({ id: 3, method: 'item/commandExecution/requestApproval', params: { threadId, itemId: 'unknown', kind: 'unknown' } });
    expect(auto.responses.at(-1)).toEqual({ id: 3, result: { decision: 'decline' } });
  });
  it('propagates failed and malformed history instead of an empty success', async () => {
    const failed = fixture({ handler: async () => { throw new Error('offline'); } });
    await expect(failed.runtime.list()).rejects.toThrow('offline');
    const malformed = fixture({ handler: async () => ({ data: null }) });
    await expect(malformed.runtime.list()).rejects.toThrow('Invalid Codex');
  });
  it('projects persisted spawn-source parents and native task destinations through the shared UI', async () => {
    const childId = '019a1500-20c1-7000-9000-4296d2ff9518';
    const child2 = '019a1500-20c1-7000-9000-4296d2ff9519';
    const child = { ...thread(), id: childId, source: { subAgent: { thread_spawn: { parent_thread_id: threadId, agent_path: '/root/check', agent_nickname: 'Checker', agent_role: 'reviewer' } } } };
    expect(toSession(child)).toMatchObject({ parentID: toPublicId(threadId), metadata: { codex: { agentPath: '/root/check', agentNickname: 'Checker', agentRole: 'reviewer' } } });
    const item = { type: 'collabAgentToolCall', id: 'spawn', tool: 'spawnAgent', status: 'completed', receiverThreadIds: [childId, child2, childId, '../invalid-child'], prompt: 'fixture task' };
    const message = toMessage({ item, startedAtMs: 100, completedAtMs: 200 }, thread(), null, new Set([childId, child2]));
    const projected = projectMessages([message], toPublicId(threadId))[0];
    expect(projected.parts[0].tool).toBe('subagent');
    expect(subagentSessionId(projected.parts[0].state.metadata)).toBe(toPublicId(childId));
    expect(projected.parts[0].state.metadata.sessionIDs).toEqual([toPublicId(childId), toPublicId(child2)]);
    const activity = toMessage({ item: { type: 'subAgentActivity', id: 'activity', agentThreadId: childId, agentPath: '/root/check', kind: 'started' } }, thread(), null, new Set([childId]));
    expect(activity.content[0]).toMatchObject({ name: 'subagent', state: { metadata: { sessionID: toPublicId(childId), sessionIDs: [toPublicId(childId)] } } });
    expect(toSession({ ...child, parentThreadId: '../invalid', source: { subAgent: { thread_spawn: { parent_thread_id: '../invalid' } } } }).parentID).toBeUndefined();
  });
  it('queries child summaries from the native database and never reads their transcripts', async () => {
    const childId = '019a1500-20c1-7000-9000-4296d2ff9518';
    const f = fixture({ handler: async () => ({ data: [{ ...thread(), id: childId, source: { subAgent: { thread_spawn: { parent_thread_id: threadId } } } }], nextCursor: null }) });
    const children = await f.runtime.list({ parentId: threadId });
    expect(children.map((child) => child.id)).toEqual([childId]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ method: 'thread/list', params: { parentThreadId: threadId, useStateDbOnly: true } });
  });
  it('keeps fresh roots and unrelated children out of a parent-scoped list', async () => {
    const ownChild = '019a1500-20c1-7000-9000-4296d2ff9518';
    const otherChild = '019a1500-20c1-7000-9000-4296d2ff9519';
    const otherParent = '019a1500-20c1-7000-9000-4296d2ff9520';
    const created = [thread(), { ...thread(), id: ownChild, source: { subAgent: { thread_spawn: { parent_thread_id: threadId } } } }, { ...thread(), id: otherChild, parentThreadId: otherParent }];
    const f = fixture({ handler: async (method) => method === 'thread/start' ? { thread: created.shift() } : { data: [], nextCursor: null } });
    await f.runtime.create({ directory: '/repo' });
    await f.runtime.create({ directory: '/repo' });
    await f.runtime.create({ directory: '/repo' });
    expect((await f.runtime.list({ parentId: threadId })).map((child) => child.id)).toEqual([ownChild]);
    expect((await f.runtime.list()).map((session) => session.id)).toEqual([threadId, ownChild, otherChild]);
  });
  it('publishes native child creation and live tool destinations using existing v2 events', async () => {
    const childId = '019a1500-20c1-7000-9000-4296d2ff9518';
    const f = fixture();
    await f.runtime.read(threadId);
    f.notify('thread/started', { thread: { ...thread(), id: childId, source: { subAgent: { thread_spawn: { parent_thread_id: threadId } } } } });
    expect(translateWireEvent(f.events[0])[0].properties.info).toMatchObject({ id: toPublicId(childId), parentID: toPublicId(threadId) });
    f.notify('item/started', { threadId, turnId: 'turn1', startedAtMs: 100, item: { type: 'subAgentActivity', id: 'activity', agentThreadId: childId, agentPath: '/root/check', kind: 'started' } });
    const progress = f.events.find((event) => event.type === 'session.tool.progress');
    expect(progress.data.metadata.sessionID).toBe(toPublicId(childId));
    expect(translateWireEvent(progress)[0].properties.transition.metadata.sessionID).toBe(toPublicId(childId));
  });
  it('shows parent, peer and self messages without task links or recipient activity, while retaining genuine child links', async () => {
    const owner = { ...thread(), parentThreadId: '019a1500-20c1-7000-9000-4296d2ff9520' };
    const peer = '019a1500-20c1-7000-9000-4296d2ff9521';
    const child = '019a1500-20c1-7000-9000-4296d2ff9522';
    const child2 = '019a1500-20c1-7000-9000-4296d2ff9523';
    const messageTo = (id, receiver, tool = 'sendMessage') => ({ type: 'collabAgentToolCall', id, tool, senderThreadId: threadId, receiverThreadIds: [receiver], prompt: `message-${id}`, status: 'completed', agentsStates: { [receiver]: { status: 'running', message: 'private-recipient-activity' } } });
    const native = [messageTo('parent', owner.parentThreadId), messageTo('peer', peer, 'sendInput'), messageTo('self', threadId), { ...messageTo('children', child, 'followupTask'), receiverThreadIds: [child, child2] }, { type: 'subAgentActivity', id: 'parent-activity', kind: 'interacted', agentThreadId: owner.parentThreadId, agentPath: '/root' }, { type: 'subAgentActivity', id: 'nested-activity', kind: 'started', agentThreadId: child, agentPath: '/root/nested' }];
    const f = fixture({ handler: async (method, params) => {
      if (method === 'thread/read') return { thread: params.threadId === threadId ? owner : { ...thread(), id: params.threadId, parentThreadId: params.threadId === peer ? owner.parentThreadId : threadId } };
      if (method === 'thread/turns/list') return { data: [{ id: 'turn', items: [], itemsView: 'summary', status: 'completed', startedAt: 10 }], nextCursor: null };
      if (method === 'thread/items/list') return { data: native.map((item, index) => ({ item, turnId: 'turn', startedAtMs: 10000 + index, completedAtMs: 10000 + index })), nextCursor: null };
      throw new Error('Unexpected RPC');
    } });
    const history = await f.runtime.messages(threadId);
    expect(history).toHaveLength(5);
    for (const [index, name] of ['sendMessage', 'sendInput', 'sendMessage'].entries()) {
      const tool = history[index].content[0];
      expect(tool.name).toBe(name);
      expect(tool.state.input.content).toBe(native[index].prompt);
      expect(tool.state.metadata.sessionID).toBeUndefined();
      expect(tool.state.metadata.sessionIDs).toBeUndefined();
      expect(JSON.stringify(tool)).not.toContain('private-recipient-activity');
      expect(JSON.stringify(tool)).not.toContain('Agent Task');
    }
    expect(history[3].content[0]).toMatchObject({ name: 'subagent', state: { metadata: { sessionIDs: [toPublicId(child), toPublicId(child2)] } } });
    expect(history[4].content[0].name).toBe('subagent');
    const metadataReads = f.calls.filter((call) => call.method === 'thread/read');
    expect(metadataReads.map((call) => call.params.threadId)).toEqual([threadId, peer, child, child2]);
    for (const [index, item] of native.entries()) f.notify('item/started', { threadId, turnId: 'turn', item, startedAtMs: 10000 + index });
    const starts = f.events.filter((event) => event.type === 'session.tool.input.started');
    expect(starts.map((event) => event.data.name)).toEqual(['sendMessage', 'sendInput', 'sendMessage', 'subagent', 'subagent']);
    const called = f.events.find((event) => event.type === 'session.tool.called');
    expect(called.data.input).toEqual({ content: 'message-parent', description: '' });
    const links = f.events.filter((event) => event.type === 'session.tool.progress').flatMap((event) => event.data.metadata.sessionIDs || []);
    expect(links).toEqual([toPublicId(child), toPublicId(child2), toPublicId(child)]);
  });
  it('does not block unrelated history or guess a child relationship after recipient metadata fails', async () => {
    const target = '019a1500-20c1-7000-9000-4296d2ff9521';
    const f = fixture({ handler: async (method, params) => {
      if (method === 'thread/read') { if (params.threadId === target) throw new Error('Recipient metadata unavailable'); return { thread: thread() }; }
      if (method === 'thread/turns/list') return { data: [{ id: 'turn', items: [], itemsView: 'summary', status: 'completed' }], nextCursor: null };
      if (method === 'thread/items/list') return { data: [{ item: { type: 'collabAgentToolCall', id: 'unknown', tool: 'sendMessage', receiverThreadIds: [target], prompt: 'sent message' }, turnId: 'turn', startedAtMs: null, completedAtMs: null }], nextCursor: null };
      throw new Error('Unexpected RPC');
    } });
    const messages = await f.runtime.messages(threadId);
    expect(messages[0].content[0]).toMatchObject({ name: 'sendMessage', state: { input: { content: 'sent message' }, metadata: {} } });
    expect(f.events).toEqual([]);
  });
  it('rejects repeated upstream cursors', async () => {
    const f = fixture({ handler: async () => ({ data: [], nextCursor: 'same' }) });
    await expect(f.runtime.list()).rejects.toThrow('repeated');
  });
  it('reads every history page from the state database without rollout repair scans', async () => {
    const secondId = '019a1500-20c1-7000-9000-4296d2ff9518';
    const f = fixture({ handler: async (method, params) => method === 'thread/loaded/list' ? { data: [], nextCursor: null } : params.cursor
      ? { data: [{ ...thread(), id: secondId }], nextCursor: null }
      : { data: [thread()], nextCursor: 'page-two' } });
    const sessions = await f.runtime.list({ archived: true });
    expect(sessions.map((session) => session.id)).toEqual([threadId, secondId]);
    const listCalls = f.calls.filter((call) => call.method === 'thread/list');
    expect(listCalls).toHaveLength(2);
    expect(listCalls.every((call) => call.params.useStateDbOnly === true && call.params.archived === true)).toBe(true);
    expect(listCalls[1].params.cursor).toBe('page-two');
  });
  it('supplements only loaded hidden children classified by the same native archive/search query', async () => {
    const childId = '019a1500-20c1-7000-9000-4296d2ff9518';
    const rootId = '019a1500-20c1-7000-9000-4296d2ff9519';
    const child = { ...thread(), id: childId, preview: '', source: { subAgent: { thread_spawn: { parent_thread_id: threadId } } } };
    const f = fixture({ handler: async (method, params) => {
      if (method === 'thread/loaded/list') return { data: [childId, rootId], nextCursor: null };
      if (method === 'thread/read') return { thread: params.threadId === childId ? child : { ...thread(), id: rootId } };
      if (method === 'thread/list') return { data: params.parentThreadId && params.archived ? [child] : [], nextCursor: null };
      throw new Error('Unexpected RPC');
    } });
    expect(await f.runtime.list({ search: 'needle' })).toEqual([]);
    expect((await f.runtime.list({ archived: true, search: 'needle' })).map((item) => item.id)).toEqual([childId]);
    const classifications = f.calls.filter((call) => call.method === 'thread/list' && call.params.parentThreadId);
    expect(classifications.map((call) => [call.params.parentThreadId, call.params.archived, call.params.searchTerm, call.params.useStateDbOnly])).toEqual([[threadId, false, 'needle', true], [threadId, true, 'needle', true]]);
    expect(f.calls.every((call) => !['thread/turns/list', 'thread/items/list', 'thread/resume'].includes(call.method))).toBe(true);
    expect(f.calls.filter((call) => call.method === 'thread/read').every((call) => !call.params.includeTurns)).toBe(true);
  });
  it('propagates failures classifying a loaded hidden child instead of publishing an empty list', async () => {
    const childId = '019a1500-20c1-7000-9000-4296d2ff9518';
    const f = fixture({ handler: async (method, params) => {
      if (method === 'thread/loaded/list') return { data: [childId], nextCursor: null };
      if (method === 'thread/read') return { thread: { ...thread(), id: childId, parentThreadId: threadId } };
      if (params.parentThreadId) throw new Error('Child classification failed');
      return { data: [], nextCursor: null };
    } });
    await expect(f.runtime.list()).rejects.toThrow('Child classification failed');
  });
  it.each(['State database is unavailable', 'State database read failed'])('propagates %s without falling back to a rollout scan or empty list', async (message) => {
    const failure = Object.assign(new Error(message), { code: -32603 });
    const f = fixture({ handler: async () => { throw failure; } });
    await expect(f.runtime.list()).rejects.toBe(failure);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].params.useStateDbOnly).toBe(true);
  });
  it('uses live loaded status rather than incomplete persisted turns', async () => {
    const f = fixture({ handler: async (method) => method === 'thread/loaded/list' ? { data: [threadId], nextCursor: null } : { thread: { ...thread(), status: { type: 'active', activeFlags: [] } } } });
    expect(await f.runtime.active('/repo')).toEqual({ [toPublicId(threadId)]: { type: 'busy' } });
    expect(await f.runtime.active('/other')).toEqual({});
  });
  it('identifies and interrupts the authoritative active turn without creating a new one', async () => {
    const f = fixture({ handler: async (method) => {
      if (method === 'thread/read') return { thread: { ...thread(), status: { type: 'active' } } };
      if (method === 'thread/turns/list') return { data: [{ id: 'turn-live', status: 'inProgress' }], nextCursor: null };
      if (method === 'turn/interrupt') return {};
      throw new Error('Unexpected RPC');
    } });
    expect(await f.runtime.interrupt(threadId)).toBe(true);
    expect(f.calls.at(-1)).toEqual({ method: 'turn/interrupt', params: { threadId, turnId: 'turn-live' } });
  });
  it('refuses busy and concurrent starts, never overrides a running thread', async () => {
    let reads = 0;
    const f = fixture({ handler: async (method) => { if (method === 'thread/read') { reads += 1; await Promise.resolve(); return { thread: { ...thread(), status: { type: 'active' } } }; } throw new Error('must not mutate'); } });
    const first = f.runtime.prompt(threadId, { text: 'one' });
    await expect(f.runtime.prompt(threadId, { text: 'two' })).rejects.toThrow('busy');
    await expect(first).rejects.toThrow('busy');
    expect(reads).toBe(1);
    expect(f.calls.every((call) => call.method === 'thread/read')).toBe(true);
  });
  it('defaults new sessions to full access without approvals in the native request', async () => {
    const f = fixture({ handler: async () => ({ thread: thread() }) });
    await f.runtime.create({ directory: '/repo' });
    expect(f.calls).toEqual([{ method: 'thread/start', params: { cwd: '/repo', model: undefined, sandbox: 'danger-full-access', approvalPolicy: 'never', config: undefined } }]);
  });
  it('preserves native permissions when resuming and prompting without an explicit mode', async () => {
    const f = fixture({ handler: async (method) => method === 'turn/start' ? { turn: { id: 'turn1' } } : method.endsWith('/list') ? { data: [], nextCursor: null } : { thread: thread() } });
    await f.runtime.resume(threadId);
    const result = await f.runtime.prompt(threadId, { text: 'hello', clientId: 'msg_user' });
    expect(result.messageID).toBe('msg_user');
    expect(f.calls.filter((call) => call.method === 'thread/resume').map((call) => call.params)).toEqual([{ threadId, excludeTurns: true }, { threadId, excludeTurns: true }]);
    expect(f.calls.find((call) => call.method === 'turn/start').params).toEqual({ threadId, clientUserMessageId: 'msg_user', input: [{ type: 'text', text: 'hello', text_elements: [] }] });
  });
  it.each([
    ['full-access', 'danger-full-access', 'never', { type: 'dangerFullAccess' }],
    ['read-only', 'read-only', 'on-request', { type: 'readOnly', networkAccess: false }],
    ['workspace-write', 'workspace-write', 'on-request', { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true }],
  ])('applies explicit %s permissions consistently to resume and turn', async (mode, sandbox, approvalPolicy, sandboxPolicy) => {
    const f = fixture({ handler: async (method) => method === 'turn/start' ? { turn: { id: 'turn1' } } : method.endsWith('/list') ? { data: [], nextCursor: null } : { thread: thread() } });
    await f.runtime.prompt(threadId, { text: 'hello', selection: { mode } });
    expect(f.calls.find((call) => call.method === 'thread/resume').params).toEqual({ threadId, excludeTurns: true, sandbox, approvalPolicy });
    expect(f.calls.find((call) => call.method === 'turn/start').params).toEqual({ threadId, input: [{ type: 'text', text: 'hello', text_elements: [] }], approvalPolicy, sandboxPolicy });
  });
  it('accepts the real composer image shape without MIME and rejects other files', async () => {
    const f = fixture({ handler: async (method) => method === 'turn/start' ? { turn: { id: 'turn1' } } : method.endsWith('/list') ? { data: [], nextCursor: null } : { thread: thread() } });
    await f.runtime.prompt(threadId, { text: '', files: [{ uri: 'data:image/png;base64,YQ==', name: 'x.png' }] });
    expect(f.calls.find((call) => call.method === 'turn/start').params.input).toEqual([{ type: 'image', url: 'data:image/png;base64,YQ==' }]);
    await expect(f.runtime.prompt(threadId, { text: '', files: [{ uri: 'file:///tmp/secret.txt', name: 'secret.txt' }] })).rejects.toThrow('image attachments only');
  });
  it.runIf(process.platform !== 'win32')('decodes local image URLs and refuses remote file hosts', async () => {
    const f = fixture({ handler: async (method) => method === 'turn/start' ? { turn: { id: 'turn1' } } : method.endsWith('/list') ? { data: [], nextCursor: null } : { thread: thread() } });
    await f.runtime.prompt(threadId, { files: [{ uri: 'file:///tmp/image%20%231.png' }] });
    expect(f.calls.find((call) => call.method === 'turn/start').params.input).toEqual([{ type: 'localImage', path: '/tmp/image #1.png' }]);
    await expect(f.runtime.prompt(threadId, { files: [{ uri: 'file://remote-host/tmp/image.png' }] })).rejects.toThrow('File URL host');
  });
  it.runIf(process.platform === 'win32')('converts a Windows image file URL to its native drive path', async () => {
    const f = fixture({ handler: async (method) => method === 'turn/start' ? { turn: { id: 'turn1' } } : method.endsWith('/list') ? { data: [], nextCursor: null } : { thread: thread() } });
    await f.runtime.prompt(threadId, { files: [{ uri: 'file:///C:/Pictures/image%20%231.png' }] });
    expect(f.calls.find((call) => call.method === 'turn/start').params.input).toEqual([{ type: 'localImage', path: 'C:\\Pictures\\image #1.png' }]);
  });
  it('keeps history and streamed text/tools on the same message and part identities', async () => {
    const f = fixture();
    await f.runtime.read(threadId);
    const item = { type: 'agentMessage', id: 'answer1', text: '' };
    f.notify('item/started', { threadId, turnId: 'turn1', item, startedAtMs: 100 });
    f.notify('item/agentMessage/delta', { threadId, turnId: 'turn1', itemId: item.id, delta: 'hello' });
    f.notify('item/completed', { threadId, turnId: 'turn1', item: { ...item, text: 'hello' }, completedAtMs: 200 });
    const history = toMessage({ item: { ...item, text: 'hello' }, startedAtMs: 100, completedAtMs: 200 }, thread());
    const translated = f.events.flatMap(translateWireEvent);
    expect(f.events.find((event) => event.type === 'session.step.started').data.assistantMessageID).toBe(history.id);
    expect(f.events.find((event) => event.type === 'session.text.ended').data).toMatchObject({ ordinal: 0, text: history.content[0].text });
    expect(translated.some((event) => event.type === 'message.part.delta' && event.properties.delta === 'hello')).toBe(true);
    const tool = { type: 'commandExecution', id: 'tool1', command: 'pwd', cwd: '/repo', status: 'inProgress', aggregatedOutput: '' };
    f.notify('item/started', { threadId, turnId: 'turn1', item: tool, startedAtMs: 200 });
    f.notify('item/completed', { threadId, turnId: 'turn1', item: { ...tool, status: 'completed', aggregatedOutput: '/repo', exitCode: 0 }, completedAtMs: 300 });
    const liveTool = f.events.find((event) => event.type === 'session.tool.success');
    const historicTool = toMessage({ item: { ...tool, status: 'completed', aggregatedOutput: '/repo' }, completedAtMs: 300 }, thread());
    expect(liveTool.data.id).toBe(historicTool.content[0].id);
    expect(liveTool.data.assistantMessageID).toBe(historicTool.id);
    expect(liveTool.data.content).toEqual(historicTool.content[0].state.content);
    expect(f.events.flatMap(translateWireEvent).some((event) => event.type === 'message.part.transition' || event.type === 'message.part.updated')).toBe(true);
  });
  it('preserves native item order across pages, tied or missing times, refetch and reconnect', async () => {
    const nativeItems = [
      { type: 'userMessage', id: 'zz-user', clientId: 'msg_zz_user', content: [{ type: 'text', text: 'prompt' }] },
      { type: 'reasoning', id: 'bb-reason', summary: ['thought'], content: [] },
      { type: 'commandExecution', id: 'aa-tool', command: 'pwd', status: 'completed' },
      { type: 'agentMessage', id: '00-answer', text: 'answer' },
      { type: 'userMessage', id: 'yy-user', clientId: 'msg_yy_user', content: [{ type: 'text', text: 'next' }] },
      { type: 'agentMessage', id: '01-answer', text: 'next answer' },
    ];
    const turn = (id) => ({ id, items: [], itemsView: 'summary', status: 'completed', startedAt: null, completedAt: null });
    const entries = nativeItems.map((item, index) => ({ item, turnId: index < 4 ? 't1' : 't2', startedAtMs: index % 2 ? null : 10000, completedAtMs: index === 2 ? 10000 : null }));
    const f = fixture({ handler: async (method, params) => {
      if (method === 'thread/read') return { thread: thread() };
      if (method === 'thread/turns/list') return { data: [turn(params.cursor ? 't2' : 't1')], nextCursor: params.cursor ? null : 'turns2' };
      if (method === 'thread/items/list') return { data: params.cursor ? entries.slice(3) : entries.slice(0, 3), nextCursor: params.cursor ? null : 'items2' };
      throw new Error('Unexpected RPC');
    } });
    const history = await f.runtime.messages(threadId);
    const projected = projectMessages(history, toPublicId(threadId)).map((record) => record.message);
    expect(sortMessagesChronologically([...projected].reverse()).map((message) => message.id)).toEqual(history.map((message) => message.id));
    expect(history.map((message) => message.time.created)).toEqual([10000, 10001, 10002, 10003, 10004, 10005]);
    expect(history[2].time.completed - history[2].time.created).toBe(0);
    expect(history[2].content[0].time.completed - history[2].content[0].time.ran).toBe(0);
    expect(history[2].time.completed).toBeGreaterThanOrEqual(history[2].time.created);
    expect(history[2].metadata.codex.timing).toEqual({ startedAtMs: 10000, completedAtMs: 10000 });
    expect(await f.runtime.messages(threadId)).toEqual(history);
    f.disconnect();
    expect(await f.runtime.messages(threadId)).toEqual(history);
    f.notify('item/started', { ...entries[4], threadId });
    expect(f.events.find((event) => event.type === 'session.inbox.enqueued').created).toBe(history[4].time.created);
    const live = fixture();
    await live.runtime.read(threadId);
    live.notify('turn/started', { threadId, turn: { id: 't1', startedAt: null } });
    for (const entry of entries.slice(0, 4)) live.notify('item/started', { ...entry, threadId });
    const liveInfos = live.events.flatMap(translateWireEvent).filter((event) => event.type === 'message.updated').map((event) => event.properties.info);
    expect(sortMessagesChronologically(liveInfos).map((message) => message.id)).toEqual(history.slice(0, 4).map((message) => message.id));
    expect(liveInfos.map((message) => message.time.created)).toEqual(history.slice(0, 4).map((message) => message.time.created));
    live.notify('item/started', { ...entries[0], threadId });
    expect(live.events.filter((event) => event.type === 'session.inbox.enqueued').at(-1).created).toBe(history[0].time.created);
    expect(live.events.filter((event) => event.type === 'session.inbox.delivered').every((event) => event.created === history[0].time.created)).toBe(true);
  });
  it('delivers each user once and maps the echoed client id', async () => {
    const f = fixture();
    await f.runtime.read(threadId);
    const item = { type: 'userMessage', id: 'native-user', clientId: 'msg_client', content: [{ type: 'text', text: 'hello' }] };
    f.notify('item/started', { threadId, item, startedAtMs: 100 });
    f.notify('item/completed', { threadId, item, completedAtMs: 200 });
    expect(f.events.filter((event) => event.type === 'session.inbox.enqueued')).toHaveLength(1);
    expect(f.events[0].data.inboxID).toBe('msg_client');
  });
  it('does not replace newer live chronology with an in-flight history snapshot', async () => {
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    let requested;
    const requestedItems = new Promise((resolve) => { requested = resolve; });
    const user = { type: 'userMessage', id: 'user-race', clientId: 'msg_zz_race', content: [{ type: 'text', text: 'hello' }] };
    const f = fixture({ handler: async (method) => {
      if (method === 'thread/read') return { thread: thread() };
      if (method === 'thread/turns/list') return { data: [{ id: 'race', items: [], itemsView: 'summary', status: 'inProgress', startedAt: 10 }], nextCursor: null };
      if (method === 'thread/items/list') { requested(); await waiting; return { data: [{ turnId: 'race', item: user, startedAtMs: null, completedAtMs: null }], nextCursor: null }; }
      throw new Error('Unexpected RPC');
    } });
    const load = f.runtime.messages(threadId);
    await requestedItems;
    f.notify('item/started', { threadId, turnId: 'race', item: user, startedAtMs: 12000 });
    release();
    const history = await load;
    expect(history[0].time.created).toBe(12000);
    expect((await f.runtime.messages(threadId))[0].time.created).toBe(12000);
    f.notify('item/started', { threadId, turnId: 'race', item: user, startedAtMs: 12000 });
    expect(f.events.filter((event) => event.type === 'session.inbox.enqueued').map((event) => event.created)).toEqual([12000, 12000]);
  });
  it('denies unknown approvals and unsupported/auth/native requests without granting anything', async () => {
    const f = fixture();
    f.ask({ id: 1, method: 'item/commandExecution/requestApproval', params: { threadId } });
    f.ask({ id: 2, method: 'account/chatgptAuthTokens/refresh', params: {} });
    f.ask({ id: 3, method: 'item/permissions/requestApproval', params: { threadId } });
    expect(f.responses).toEqual([{ id: 1, result: { decision: 'decline' } }]);
    expect(f.errors).toHaveLength(2);
    expect(f.runtime.pending('permission')).toEqual([]);
  });
  it('routes approval answers by session, supports forms and refuses when policy changes', async () => {
    let allowed = true;
    const f = fixture({ allowed: () => allowed });
    await f.runtime.read(threadId);
    f.ask({ id: 4, method: 'item/commandExecution/requestApproval', params: { threadId, itemId: 'tool', command: 'pwd' } });
    const request = f.runtime.pending('permission')[0];
    const permissionEvent = f.events.find((event) => event.type === 'permission.asked');
    expect(translateWireEvent(permissionEvent)[0].properties.id).toBe(request.id);
    expect(f.runtime.replyPermission('another', request.id, 'once')).toBe(false);
    allowed = false;
    expect(f.runtime.replyPermission(threadId, request.id, 'always')).toBe(true);
    expect(f.responses.at(-1)).toEqual({ id: 4, result: { decision: 'decline' } });
    allowed = true;
    f.ask({ id: 5, method: 'item/tool/requestUserInput', params: { threadId, questions: [{ id: 'q', question: 'Which?', options: [{ label: 'A' }] }] } });
    const form = f.runtime.pending('form')[0];
    expect(translateWireEvent(f.events.find((event) => event.type === 'form.created'))[0].properties.form.id).toBe(form.id);
    f.runtime.replyForm(threadId, form.id, { q: 'A' });
    expect(f.responses.at(-1)).toEqual({ id: 5, result: { answers: { q: { answers: ['A'] } } } });
  });
  it('clears withdrawn approvals on disconnect, publishes uncertainty without a false idle', async () => {
    const f = fixture();
    await f.runtime.read(threadId);
    f.notify('turn/started', { threadId, turn: { id: 't' } });
    f.ask({ id: 1, method: 'item/fileChange/requestApproval', params: { threadId, itemId: 'edit' } });
    f.disconnect();
    expect(f.runtime.pending('permission')).toEqual([]);
    expect(f.events.at(-1).type).toBe('session.execution.failed');
    expect(f.events.some((event) => event.type === 'session.idle')).toBe(false);
  });
});
