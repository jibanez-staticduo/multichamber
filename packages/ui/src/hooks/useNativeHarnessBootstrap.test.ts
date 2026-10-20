import { afterEach, beforeEach, expect, test } from 'bun:test';
import { refreshNativeHarness } from './useNativeHarnessBootstrap';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { getRuntimeKey, switchRuntimeEndpoint } from '@/lib/runtime-switch';
import { applyGlobalSessionStatusEvent, replaceGlobalSessionStatusById, useGlobalSessionStatusStore } from '@/sync/global-session-status';
import { applyGlobalBlockingRequestEvents, resetGlobalBlockingRequests, useGlobalBlockingRequestsStore } from '@/sync/global-blocking-requests';
import type { Session } from '@/lib/opencode/model';

const originalFetch = globalThis.fetch;
const nativeId = 'ses_cdx12345678-1234-4234-8234-123456789abc';
const native = { id: nativeId, projectID: 'project', location: { directory: '/repo' }, title: 'Native', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, updated: 2 }, metadata: { backend: 'codex' } };
const opencode: Session = { ...native, id: 'ses_opencode', directory: '/repo', metadata: { backend: 'opencode' } };
let active = true;

beforeEach(() => {
  useConfigStore.setState({ isConnected: false });
  useGlobalSessionsStore.getState().resetForRuntimeSwitch();
  useGlobalSessionsStore.getState().upsertSession(opencode);
  replaceGlobalSessionStatusById(new Map());
  resetGlobalBlockingRequests();
  applyGlobalSessionStatusEvent('/repo', { type: 'session.status', properties: { sessionID: opencode.id, status: { type: 'busy' } } });
  active = true;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/sessions')) return Response.json({ harness: 'codex', data: [native], cursor: { previous: null, next: null } });
    if (url.includes('/active')) return Response.json({ harness: 'codex', data: active ? { [nativeId]: { type: 'busy' } } : {} });
    return Response.json({ harness: 'codex', data: [] });
  };
});
afterEach(() => { globalThis.fetch = originalFetch; replaceGlobalSessionStatusById(new Map()); });

test('native history and empty activity never remove an OpenCode session or its running status', async () => {
  await refreshNativeHarness('codex', getRuntimeKey(), new AbortController().signal);
  expect(useGlobalSessionsStore.getState().entityById.has(opencode.id)).toBe(true);
  expect(useGlobalSessionsStore.getState().entityById.has(nativeId)).toBe(true);
  expect(useGlobalSessionsStore.getState().hasLoaded).toBe(false);
  expect(useGlobalSessionStatusStore.getState().activeSessionIds.has(nativeId)).toBe(true);
  active = false;
  await refreshNativeHarness('codex', getRuntimeKey(), new AbortController().signal);
  expect(useGlobalSessionStatusStore.getState().activeSessionIds.has(nativeId)).toBe(false);
  expect(useGlobalSessionStatusStore.getState().activeSessionIds.has(opencode.id)).toBe(true);
});

test('a native history failure preserves all known sessions', async () => {
  globalThis.fetch = async () => new Response(null, { status: 502 });
  await expect(refreshNativeHarness('codex', getRuntimeKey(), new AbortController().signal)).rejects.toThrow('502');
  expect(useGlobalSessionsStore.getState().entityById.has(opencode.id)).toBe(true);
});

test('native empty pending clears only its engine and preserves other-engine requests', async () => {
  for (const sessionID of [nativeId, opencode.id]) applyGlobalBlockingRequestEvents('/repo', [{ type: 'permission.asked', properties: { id: `per_${sessionID}`, sessionID, action: 'shell', resources: ['git status'], save: [] } }]);
  await refreshNativeHarness('codex', getRuntimeKey(), new AbortController().signal);
  expect(useGlobalBlockingRequestsStore.getState().bySession.has(nativeId)).toBe(false);
  expect(useGlobalBlockingRequestsStore.getState().bySession.has(opencode.id)).toBe(true);
});

test('a deferred result from the previous runtime cannot populate the new host', async () => {
  let release: (response: Response) => void = () => {};
  globalThis.fetch = (input) => String(input).includes('/api/harnesses/codex/sessions')
    ? new Promise<Response>((resolve) => { release = resolve; })
    : Promise.resolve(Response.json({}));
  const previousRuntime = getRuntimeKey();
  const refresh = refreshNativeHarness('codex', previousRuntime, new AbortController().signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  switchRuntimeEndpoint({ apiBaseUrl: 'http://different-native-host.test', runtimeKey: 'different-native-host' });
  release(Response.json({ harness: 'codex', data: [native] }));
  await refresh;
  expect(useGlobalSessionsStore.getState().entityById.has(nativeId)).toBe(false);
  switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: previousRuntime });
});
