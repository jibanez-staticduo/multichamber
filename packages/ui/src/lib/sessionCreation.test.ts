import { afterEach, expect, test } from 'bun:test';
import { requestSessionCreation } from './sessionCreation';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useEngineStore } from '@/stores/useEngineStore';
import { SESSION_ENGINE_INFO } from './sessionEngine';
import { getRuntimeKey } from './runtime-switch';
import { invalidateSettingsCache } from './persistence';
const oldFetch = globalThis.fetch;
const oldOpen = useSessionUIStore.getState().openNewSessionDraft;
afterEach(() => { globalThis.fetch = oldFetch; useSessionUIStore.setState({ openNewSessionDraft: oldOpen }); invalidateSettingsCache(); });

for (const harness of ['opencode', 'claude', 'codex'] as const) {
  test(`all normal entrypoints resolve saved ${harness} without a model dialog or provider catalog`, async () => {
    invalidateSettingsCache();
    const runtime = getRuntimeKey();
    useEngineStore.setState({ requested: { [runtime]: true }, byRuntime: { [runtime]: { ...SESSION_ENGINE_INFO, claude: { ...SESSION_ENGINE_INFO.claude, available: true }, codex: { ...SESSION_ENGINE_INFO.codex, available: true } } } });
    const calls: unknown[] = [];
    globalThis.fetch = async (input) => {
      expect(String(input)).toContain('/api/config/settings');
      return Response.json({ defaultHarness: harness, codexDefaultModel: 'saved-native-model', claudeDefaultModel: 'saved-native-model' });
    };
    useSessionUIStore.setState({ openNewSessionDraft: (options) => { calls.push({ ...options, onCreated: undefined }); options?.onCreated?.({ id: 'created', projectID: 'project', directory: '/repo', title: 'native', time: { created: 1, updated: 1 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }); } });
    await requestSessionCreation({ directoryOverride: '/project' });
    expect(calls).toEqual([{ directoryOverride: '/project', harness, resolvedHarness: true, onCreated: undefined }]);
  });
}

test('an unavailable saved harness refuses creation instead of falling through to OpenCode', async () => {
  invalidateSettingsCache();
  const runtime = getRuntimeKey();
  useEngineStore.setState({ requested: { [runtime]: true }, byRuntime: { [runtime]: { ...SESSION_ENGINE_INFO, codex: { ...SESSION_ENGINE_INFO.codex, available: false } } } });
  globalThis.fetch = async () => Response.json({ defaultHarness: 'codex' });
  let opened = false;
  useSessionUIStore.setState({ openNewSessionDraft: () => { opened = true; } });
  await expect(requestSessionCreation()).rejects.toThrow('Codex is not available');
  expect(opened).toBe(false);
});

test('native creation rejects an isolated-space target before opening or writing defaults', async () => {
  invalidateSettingsCache();
  const runtime = getRuntimeKey();
  useEngineStore.setState({ requested: { [runtime]: true }, byRuntime: { [runtime]: { ...SESSION_ENGINE_INFO, codex: { ...SESSION_ENGINE_INFO.codex, available: true } } } });
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => { methods.push(init?.method ?? 'GET'); return Response.json({ defaultHarness: 'codex' }); };
  let opened = false;
  useSessionUIStore.setState({ openNewSessionDraft: () => { opened = true; } });
  await expect(requestSessionCreation({ harness: 'codex', directoryOverride: '/spaces/123456abcdef/repo' })).rejects.toThrow('cannot create sessions');
  expect(opened).toBe(false);
  expect(methods).toEqual(['GET']);
});

test('creation waits for a concurrent engine catalog request before checking native availability', async () => {
  invalidateSettingsCache();
  const runtime = getRuntimeKey();
  useEngineStore.setState({ requested: {}, byRuntime: {} });
  let finish: ((value: Response) => void) | undefined;
  const engineResponse = new Promise<Response>((resolve) => { finish = resolve; });
  globalThis.fetch = async (input) => String(input).includes('/api/engines') ? engineResponse : Response.json({ defaultHarness: 'codex' });
  const loading = useEngineStore.getState().load(runtime);
  let opened = false;
  useSessionUIStore.setState({ openNewSessionDraft: (options) => { opened = true; options?.onCreated?.({ id: 'created', projectID: 'project', directory: '/repo', title: 'native', time: { created: 1, updated: 1 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }); } });
  const creation = requestSessionCreation();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(opened).toBe(false);
  finish?.(Response.json({ engines: [{ id: 'codex', available: true }] }));
  await Promise.all([loading, creation]);
  expect(opened).toBe(true);
});

test('an internal explicit harness does not replace the saved default', async () => {
  invalidateSettingsCache();
  const runtime = getRuntimeKey();
  useEngineStore.setState({ requested: { [runtime]: true }, byRuntime: { [runtime]: SESSION_ENGINE_INFO } });
  const methods: string[] = [];
  globalThis.fetch = async (_input, init) => { methods.push(init?.method ?? 'GET'); return Response.json({ defaultHarness: 'codex' }); };
  useSessionUIStore.setState({ openNewSessionDraft: () => {} });
  await requestSessionCreation({ harness: 'opencode' });
  expect(methods).toEqual(['GET']);
});

test('a runtime switch during deferred settings cancels creation and its attachment/navigation continuation', async () => {
  invalidateSettingsCache();
  const { switchRuntimeEndpoint, getRuntimeApiBaseUrl } = await import('./runtime-switch');
  const originalRuntime = getRuntimeKey();
  const originalBase = getRuntimeApiBaseUrl();
  let finish: ((value: Response) => void) | undefined;
  globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
  let opened = false;
  let attachedOrNavigated = false;
  useSessionUIStore.setState({ openNewSessionDraft: () => { opened = true; } });
  const creation = requestSessionCreation().then(() => { attachedOrNavigated = true; });
  for (let i = 0; i < 20 && !finish; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  try {
    switchRuntimeEndpoint({ apiBaseUrl: 'https://new-host.example', runtimeKey: 'new-creation-host' });
    finish?.(Response.json({ defaultHarness: 'codex' }));
    await expect(creation).rejects.toThrow(DOMException);
    expect(opened).toBe(false);
    expect(attachedOrNavigated).toBe(false);
  } finally { switchRuntimeEndpoint({ apiBaseUrl: originalBase, runtimeKey: originalRuntime }); }
});
