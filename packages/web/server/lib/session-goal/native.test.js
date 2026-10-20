import { afterEach, expect, test, vi } from 'vitest';
import { configureSessionHarnesses } from '../harnesses/session-client.js';
import { createSessionGoalRuntime } from './runtime.js';
const running = [];
afterEach(() => { running.forEach((runtime) => runtime.stop()); running.length = 0; configureSessionHarnesses(() => null); vi.restoreAllMocks(); });
const wait = async () => { for (let i = 0; i < 12; i++) await new Promise((resolve) => setTimeout(resolve, 5)); };
const goal = { id: 'goal-native', objective: 'Finish the native task', status: 'active', turnsUsed: 0, tokensUsed: 0, tokensCommitted: 0, tokensBaseline: 0, createdAt: 1, updatedAt: 1 };
function fixture(harness, activity = async () => ({ statuses: {}, children: [] })) {
  const id = harness === 'codex' ? 'ses_cdxnative' : 'ses_cccnative';
  let current = { ...goal };
  const prompt = vi.fn(async () => ({}));
  const metadata = () => ({ openchamber: { goal: current } });
  const client = {
    get: vi.fn(async () => ({ id, location: { directory: '/repo' }, metadata: metadata() })),
    messages: vi.fn(async () => ({ data: [{ id: 'answer', sessionID: id, type: 'assistant', agent: 'native', model: { providerID: harness, id: 'native-model' }, content: [{ type: 'text', text: 'Step one is complete, more remains.' }], finish: 'stop', time: { created: 10, completed: 20 }, metadata: { codex: { usageAvailable: true } }, tokens: { input: 10, output: 5, cache: { read: 0, write: 0 } } }] })),
    activity: vi.fn(activity), prompt,
  };
  configureSessionHarnesses((sessionID) => sessionID === id ? { sessionClient: client } : null);
  const openCode = vi.fn(() => { throw new Error('Native goal must not query OpenCode'); });
  const runtime = createSessionGoalRuntime({ buildOpenCodeUrl: openCode, getOpenCodeAuthHeaders: () => ({}), getSmallModelService: async () => ({ generateSmallModelText: async () => ({ text: JSON.stringify({ all_done: false, remaining: true, needs_user: false }), providerID: 'utility', modelID: 'checker' }) }), getChecker: () => 'small-model', isEnabled: () => true, kickoffQuietMs: 1, idleQuietMs: 5, readSessionMetadata: async () => metadata(), persistSessionGoal: async (_id, _directory, next) => { current = next; } });
  running.push(runtime);
  return { id, runtime, client, openCode, metadata, pause: () => { current = { ...current, status: 'paused' }; }, budget: (value) => { current = { ...current, tokenBudget: value }; } };
}
for (const harness of ['claude', 'codex']) test(`${harness} goal continues through its native owner without OpenCode calls`, async () => {
  const f = fixture(harness);
  await f.runtime.notifyGoalChanged(f.id, '/repo', f.metadata()); await wait();
  expect(f.client.prompt).toHaveBeenCalledTimes(1);
  expect(f.client.prompt.mock.calls[0][1].text).toContain('Finish the native task');
  expect(f.openCode).not.toHaveBeenCalled();
});
test('a native busy child defers the goal and a manual pause prevents the later continuation', async () => {
  let busy = true;
  const f = fixture('codex', async () => ({ statuses: busy ? { child: { type: 'busy' } } : {}, children: [{ id: 'child', parentID: 'ses_cdxnative' }] }));
  await f.runtime.notifyGoalChanged(f.id, '/repo', f.metadata()); await wait();
  expect(f.client.prompt).not.toHaveBeenCalled();
  f.pause(); busy = false; await wait();
  expect(f.client.prompt).not.toHaveBeenCalled();
  expect(f.openCode).not.toHaveBeenCalled();
});
test('a failed native activity read is unknown and preserves the active goal without sending', async () => {
  const f = fixture('claude', async () => { throw new Error('native transport unavailable'); });
  await f.runtime.notifyGoalChanged(f.id, '/repo', f.metadata()); await wait();
  expect(f.client.prompt).not.toHaveBeenCalled();
  expect(f.metadata().openchamber.goal.status).toBe('active');
  expect(f.openCode).not.toHaveBeenCalled();
});

test('a native token budget accounts actual per-turn usage and stops before continuing', async () => {
  const f = fixture('codex'); f.budget(10);
  await f.runtime.notifyGoalChanged(f.id, '/repo', f.metadata()); await wait();
  expect(f.client.prompt).not.toHaveBeenCalled();
  expect(f.metadata().openchamber.goal).toMatchObject({ status: 'budgetLimited', tokensUsed: 15 });
  expect(f.openCode).not.toHaveBeenCalled();
});
test('unknown Codex usage blocks an explicitly budgeted goal instead of charging a fake zero', async () => {
  const f = fixture('codex'); f.budget(100);
  const original = f.client.messages;
  f.client.messages = vi.fn(async (...args) => { const page = await original(...args); delete page.data[0].metadata; return page; });
  await f.runtime.notifyGoalChanged(f.id, '/repo', f.metadata()); await wait();
  expect(f.client.prompt).not.toHaveBeenCalled();
  expect(f.metadata().openchamber.goal).toMatchObject({ status: 'blocked', statusReason: 'token usage unavailable' });
});
