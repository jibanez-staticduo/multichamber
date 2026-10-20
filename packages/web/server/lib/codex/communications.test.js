import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createCommunicationReader } from './communications.js';
import { createCodexRuntime } from './runtime.js';
import { translateWireEvent } from '../../../../ui/src/lib/opencode/events.ts';
import { tokensOf } from './wire.js';

const id = '019a1500-20c1-7000-9000-4296d2ff9517';
const parent = '019a1500-20c1-7000-9000-4296d2ff9518';
const line = (type, payload, timestamp = '2026-10-19T10:00:00.000Z') => `${JSON.stringify({ type, payload, timestamp })}\n`;
const context = line('turn_context', { turn_id: 'turn' });
const call = (callId = 'call-1') => line('response_item', { type: 'function_call', namespace: 'collaboration', name: 'send_message', call_id: callId, arguments: JSON.stringify({ target: '/root', message: `message ${callId}` }) });
const output = (callId = 'call-1') => line('response_item', { type: 'function_call_output', call_id: callId, output: 'parent activity must not be shown' });

it('reads communication args incrementally, defers incomplete tails and keeps only completion status', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'codex-comms-'));
  const file = path.join(home, 'thread.jsonl');
  const reader = createCommunicationReader();
  try {
    await writeFile(file, context + call().slice(0, -1));
    expect(await reader.read({ id, path: file })).toEqual([]);
    await appendFile(file, '\n');
    const pending = await reader.read({ id, path: file });
    expect(pending[0].item).toMatchObject({ id: 'call-1', prompt: 'message call-1', description: '/root', status: 'inProgress' });
    await appendFile(file, output());
    const settled = await reader.read({ id, path: file });
    expect(settled).toHaveLength(1);
    expect(settled[0].item.status).toBe('completed');
    expect(JSON.stringify(settled)).not.toContain('parent activity');
    expect(await reader.read({ id, path: file })).toEqual(settled);
    await appendFile(file, 'not json\n');
    await expect(reader.read({ id, path: file })).rejects.toThrow();
  } finally { reader.dispose(); await rm(home, { recursive: true, force: true }); }
});

it('recovers per-turn numeric usage without counting cached input twice', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'codex-usage-'));
  const file = path.join(home, 'thread.jsonl');
  const reader = createCommunicationReader();
  const count = (input, cached, output) => line('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 0 } } });
  try {
    await writeFile(file, context + count(10, 4, 3) + line('turn_context', { turn_id: 'turn2' }) + count(18, 7, 5));
    await reader.read({ id, path: file });
    const first = tokensOf(reader.usage(id).get('turn'));
    const second = tokensOf(reader.usage(id).get('turn2'));
    expect(first.input + first.output + first.cache.read).toBe(13);
    expect(second.input + second.output + second.cache.read).toBe(10);
    expect(first.input).toBe(6);
    expect(second.input).toBe(5);
  } finally { reader.dispose(); await rm(home, { recursive: true, force: true }); }
});

it('separates last-response context from cumulative billing and clears it after compaction', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'codex-context-'));
  const file = path.join(home, 'thread.jsonl');
  const reader = createCommunicationReader();
  const count = (turn, total, last, window) => line('turn_context', { turn_id: turn }) + line('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: total - 3, cached_input_tokens: 0, output_tokens: 3, reasoning_output_tokens: 0 }, last_token_usage: { total_tokens: last }, model_context_window: window } });
  try {
    await writeFile(file, count('turn', 900, 90, 1000) + count('turn2', 1900, 100, 1000));
    await reader.read({ id, path: file });
    expect(reader.context(id)).toEqual({ state: 'measured', tokens: 100, window: 1000 });
    expect(reader.cumulativeUsage(id).get('turn2').inputTokens + reader.cumulativeUsage(id).get('turn2').outputTokens).toBe(1900);
    await appendFile(file, line('compacted', {}));
    await reader.read({ id, path: file });
    expect(reader.context(id)).toEqual({ state: 'compacted', window: 1000 });
    await appendFile(file, count('turn3', 2000, 40, null));
    await reader.read({ id, path: file });
    expect(reader.context(id)).toEqual({ state: 'measured', tokens: 40, window: null });
  } finally { reader.dispose(); await rm(home, { recursive: true, force: true }); }
});

it('keeps native detail available but rejects incomplete history when communication recovery fails', async () => {
  const events = [];
  const thread = { id, path: '/nonexistent/codex-communication-fixture.jsonl', cwd: '/repo', createdAt: 1, updatedAt: 1, status: { type: 'idle' } };
  const runtime = createCodexRuntime({ publishEvent: ({ payload }) => events.push(payload), rpcFactory: () => ({ ensureAvailable: async () => true, dispose: async () => {}, request: async (method) => method === 'thread/read' || method === 'thread/resume' ? { thread } : { data: [], nextCursor: null } }) });
  try {
    expect((await runtime.resume(id)).id).toBe(id);
    await expect(runtime.messages(id)).rejects.toThrow('ENOENT');
    expect(events).toEqual([]);
  } finally { await runtime.dispose(); }
});

it('enriches matching native activity and publishes later communication completion once', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'codex-comms-live-'));
  const file = path.join(home, 'thread.jsonl');
  const thread = { id, path: file, cwd: home, createdAt: 1, updatedAt: 1, parentThreadId: parent, status: { type: 'idle' } };
  const events = [];
  let notify;
  const runtime = createCodexRuntime({
    publishEvent: ({ payload }) => events.push(payload),
    rpcFactory: (callbacks) => {
      notify = callbacks.onNotification;
      return { ensureAvailable: async () => true, dispose: async () => {}, request: async (method) => {
        if (method === 'thread/read' || method === 'thread/resume') return { thread };
        if (method === 'thread/turns/list') return { data: [{ id: 'turn', items: [], itemsView: 'summary', status: 'completed', startedAt: 1 }], nextCursor: null };
        if (method === 'thread/items/list') return { data: [{ turnId: 'turn', startedAtMs: null, completedAtMs: null, item: { type: 'userMessage', id: 'user', content: [{ type: 'text', text: 'user' }] } }, { turnId: 'turn', startedAtMs: null, completedAtMs: null, item: { type: 'subAgentActivity', id: 'call-1', agentThreadId: parent, kind: 'interacted' } }], nextCursor: null };
        return { data: [], nextCursor: null };
      } };
    },
  });
  try {
    await writeFile(file, context + call() + output());
    const history = await runtime.messages(id);
    expect(history.map((message) => message.type)).toEqual(['user', 'assistant']);
    expect(history[1].content[0]).toMatchObject({ name: 'send_message', state: { input: { content: 'message call-1', description: '/root' }, metadata: {} } });
    expect(history[1].content[0].id).toBe('call-1');
    await runtime.resume(id);
    await appendFile(file, call('call-2'));
    const activity = { type: 'subAgentActivity', id: 'call-2', agentThreadId: parent, kind: 'interacted' };
    notify('item/started', { threadId: id, turnId: 'turn', item: activity });
    for (let attempt = 0; attempt < 30 && !events.some((event) => event.type === 'session.tool.called'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    await appendFile(file, output('call-2'));
    notify('item/completed', { threadId: id, turnId: 'turn', item: activity });
    notify('item/completed', { threadId: id, turnId: 'turn', item: activity });
    for (let attempt = 0; attempt < 30 && !events.some((event) => event.type === 'session.tool.success'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(events.filter((event) => event.type === 'session.tool.input.started' && event.data.id === 'call-2')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'session.tool.success' && event.data.id === 'call-2')).toHaveLength(1);
    expect(events.find((event) => event.type === 'session.tool.called').data.input).toEqual({ content: 'message call-2', description: '/root' });
    const liveId = events.find((event) => event.type === 'session.step.started').data.assistantMessageID;
    expect(events.flatMap(translateWireEvent).some((event) => event.type === 'message.updated' && event.properties.info.id === liveId)).toBe(true);
    const refreshed = await runtime.messages(id);
    expect(refreshed.some((message) => message.id === liveId)).toBe(true);
  } finally { await runtime.dispose(); await rm(home, { recursive: true, force: true }); }
});

it('rescans an interaction arriving during a read and keeps a new-session subscription', async () => {
  const thread = { id, cwd: '/repo', createdAt: 1, updatedAt: 1, parentThreadId: parent, status: { type: 'idle' } };
  const events = [];
  let notify;
  let finishRead;
  let reads = 0;
  const entry = { turnId: 'turn', startedAtMs: 1000, completedAtMs: 1001, item: { type: 'collabAgentToolCall', id: 'call-dirty', tool: 'send_message', receiverThreadIds: [], prompt: 'exact message', description: '/root', status: 'completed' } };
  const runtime = createCodexRuntime({
    publishEvent: ({ payload }) => events.push(payload),
    communicationReader: { read: async () => { reads += 1; if (reads === 1) return new Promise((resolve) => { finishRead = resolve; }); return [entry]; }, dispose: () => {} },
    rpcFactory: (callbacks) => { notify = callbacks.onNotification; return { dispose: async () => {}, ensureAvailable: async () => true, request: async (method) => method === 'turn/start' ? { turn: { id: 'turn' } } : { thread } }; },
  });
  try {
    await runtime.create({ directory: '/repo' });
    await runtime.resume(id);
    await runtime.prompt(id, { text: 'prompt' });
    const activity = { type: 'subAgentActivity', id: 'call-dirty', agentThreadId: parent, kind: 'interacted' };
    notify('item/started', { threadId: id, turnId: 'turn', item: activity });
    notify('item/completed', { threadId: id, turnId: 'turn', item: activity });
    finishRead([]);
    for (let attempt = 0; attempt < 30 && !events.some((event) => event.type === 'session.tool.success'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    expect(reads).toBe(2);
    expect(events.filter((event) => event.type === 'session.tool.input.started')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'session.tool.success')).toHaveLength(1);
    expect(events.find((event) => event.type === 'session.tool.called').data.input.content).toBe('exact message');
  } finally { await runtime.dispose(); }
});
