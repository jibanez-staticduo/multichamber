import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { createRoot, installDom } from '@/test-utils/happyDomHarness';

test('a saved Codex draft displays native model, effort and mode without OpenCode models or a session', async () => {
  const dom = installDom(); const root = createRoot(dom.container); const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input) => { requests.push(String(input)); return Response.json({ models: [{ id: 'native-model', label: 'Saved Codex model' }], defaultModelId: 'native-model', efforts: [{ id: 'high', label: 'High' }], defaultEffort: 'high', modes: [{ id: 'full-access', label: 'Full access' }], defaultMode: 'full-access' }); };
  const { useSessionUIStore } = await import('@/sync/session-ui-store');
  const { NativeDraftModelControls } = await import('./NativeDraftModelControls');
  const { I18nProvider } = await import('@/lib/i18n');
  const prior = useSessionUIStore.getState().newSessionDraft;
  useSessionUIStore.setState({ newSessionDraft: { ...prior, open: true, harness: 'codex' }, currentSessionId: null });
  try {
    await act(async () => root.render(<I18nProvider><NativeDraftModelControls harness="codex" /></I18nProvider>));
    expect([...dom.container.querySelectorAll('button')].map((button) => button.textContent)).toEqual(['Saved Codex model', 'High', 'Full access']);
    expect(requests.some((url) => url.includes('/api/codex/models'))).toBe(true);
    expect(requests.some((url) => /\/api\/session\//.test(url))).toBe(false);
  } finally { await act(async () => root.unmount()); useSessionUIStore.setState({ newSessionDraft: prior }); globalThis.fetch = originalFetch; dom.restore(); }
});

test('changing the draft model resets effort to that model and the first native create carries the selection', async () => {
  const dom = installDom(); const root = createRoot(dom.container); const originalFetch = globalThis.fetch;
  const oldComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  const catalog = { models: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: '' }], defaultReasoningEffort: 'low' }], defaultModelId: 'first', efforts: [{ id: 'high', label: 'High' }, { id: 'low', label: 'Low' }], defaultEffort: 'high', modes: [{ id: 'full-access', label: 'Full access' }], defaultMode: 'full-access' };
  globalThis.fetch = async () => Response.json(catalog);
  const { useSessionUIStore, materializeOpenDraftSession } = await import('@/sync/session-ui-store');
  const { NativeDraftModelControls } = await import('./NativeDraftModelControls');
  const { I18nProvider } = await import('@/lib/i18n');
  const { opencodeClient } = await import('@/lib/opencode/client');
  const { ChildStoreManager } = await import('@/sync/child-store');
  const { setActionRefs } = await import('@/sync/session-actions');
  const stores = new ChildStoreManager(); setActionRefs(stores, () => '/repo');
  const previous = useSessionUIStore.getState(); const originalCreate = opencodeClient.createSession;
  let created: Parameters<typeof opencodeClient.createSession>[0] | undefined;
  opencodeClient.createSession = async (input) => { created = input; return { id: 'ses_cdxfirst', directory: '/repo', projectID: 'p', title: '', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, updated: 1 }, metadata: { backend: 'codex' } }; };
  useSessionUIStore.setState({ newSessionDraft: { ...previous.newSessionDraft, draftId: 451, open: true, harness: 'codex', nativeSelection: undefined, target: 'project', directoryOverride: '/repo', preserveDirectoryOverride: true, selectedProjectId: null }, currentSessionId: null });
  try {
    await act(async () => root.render(<I18nProvider><NativeDraftModelControls harness="codex" /></I18nProvider>));
    await act(async () => dom.container.querySelector<HTMLButtonElement>('button[aria-label="Model"]')?.click());
    const second = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === 'Second');
    expect(second === undefined).toBe(false);
    await act(async () => second?.click());
    expect(useSessionUIStore.getState().newSessionDraft.nativeSelection).toEqual({ model: 'second', effort: 'low' });
    await act(async () => { await materializeOpenDraftSession({ providerID: 'foreign', modelID: 'wrong' }); });
    expect(created?.metadata).toMatchObject({ backend: 'codex', codex: { model: 'second', effort: 'low' } });
    expect(created?.model).toBeUndefined();
  } finally { await act(async () => root.unmount()); useSessionUIStore.setState(previous); opencodeClient.createSession = originalCreate; globalThis.fetch = originalFetch; stores.disposeAll(); globalThis.getComputedStyle = oldComputedStyle; dom.restore(); }
});

test('a failed catalog shows a retry action and a response for an old runtime is ignored', async () => {
  const dom = installDom(); const root = createRoot(dom.container); const originalFetch = globalThis.fetch;
  const { switchRuntimeEndpoint, getRuntimeApiBaseUrl, getRuntimeKey } = await import('@/lib/runtime-switch');
  const base = getRuntimeApiBaseUrl(); const runtime = getRuntimeKey();
  const { NativeDraftModelControls } = await import('./NativeDraftModelControls');
  const { I18nProvider } = await import('@/lib/i18n');
  let finish: ((value: Response) => void) | undefined;
  globalThis.fetch = async () => new Response('', { status: 503 });
  try {
    await act(async () => root.render(<I18nProvider><NativeDraftModelControls harness="codex" /></I18nProvider>));
    expect(dom.container.textContent).toContain('Could not create the Codex session');
    expect([...dom.container.querySelectorAll('button')].some((button) => button.textContent === 'Try again')).toBe(true);
    globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
    await act(async () => dom.container.querySelector('button')?.click());
    switchRuntimeEndpoint({ apiBaseUrl: 'https://new-draft-host.example', runtimeKey: 'new-draft-host' });
    globalThis.fetch = async () => new Response('', { status: 503 });
    await act(async () => root.render(<I18nProvider><NativeDraftModelControls harness="codex" /></I18nProvider>));
    await act(async () => finish?.(Response.json({ models: [{ id: 'stale', label: 'Stale model' }], defaultModelId: 'stale', efforts: [], defaultEffort: null, modes: [], defaultMode: null })));
    expect(dom.container.textContent).not.toContain('Stale model');
  } finally { await act(async () => root.unmount()); switchRuntimeEndpoint({ apiBaseUrl: base, runtimeKey: runtime }); globalThis.fetch = originalFetch; dom.restore(); }
});
