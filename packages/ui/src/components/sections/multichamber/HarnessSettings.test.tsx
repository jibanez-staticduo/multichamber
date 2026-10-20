import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { createRoot, installDom } from '@/test-utils/happyDomHarness';
import { HarnessRuntimeSettings } from './HarnessSettings';
import { I18nProvider } from '@/lib/i18n';

test('all three runtimes show independent availability and checks never execute updates', async () => {
  const dom = installDom();
  const root = createRoot(dom.container);
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const entry = (id: string, installed: boolean) => ({ id, installed, running: installed, version: installed ? '1.0' : null, latestVersion: null, checkError: null, update: { status: 'manual', reason: 'native-owner', action: 'native update' }, defaults: { model: null, effort: null, mode: null } });
  globalThis.fetch = async (input) => {
    const route = String(input); requests.push(route);
    return Response.json(route.endsWith('/check') ? { ...entry('codex', true), latestVersion: '2.0' } : { harnesses: [entry('opencode', true), entry('claude', false), entry('codex', true)] });
  };
  try {
    await act(async () => root.render(<I18nProvider><HarnessRuntimeSettings /></I18nProvider>));
    expect(dom.container.textContent).toContain('OpenCode');
    expect(dom.container.textContent).toContain('Claude Code');
    expect(dom.container.textContent).toContain('Codex');
    expect(dom.container.querySelector('[data-settings-item="sessions.harness-claude-runtime"]')?.textContent).toContain('Not installed');
    const check = dom.container.querySelector<HTMLButtonElement>('[data-settings-item="sessions.harness-codex-runtime"] button');
    if (!check) throw new Error('Codex update check button missing');
    await act(async () => check.click());
    expect(dom.container.querySelector('[data-settings-item="sessions.harness-codex-runtime"]')?.textContent).toContain('2.0');
    expect(requests).toEqual(['/api/harnesses', '/api/harnesses/codex/check']);
  } finally { await act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.restore(); }
});


test('a host switch discards the previous host status response', async () => {
  const dom = installDom();
  const root = createRoot(dom.container);
  const originalFetch = globalThis.fetch;
  const { switchRuntimeEndpoint } = await import('@/lib/runtime-switch');
  let releaseOld: (response: Response) => void = () => undefined;
  const oldResponse = new Promise<Response>((resolve) => { releaseOld = resolve; });
  let reads = 0;
  const entry = (version: string) => ({ id: 'codex', installed: true, running: true, version, latestVersion: null, checkError: null, update: { status: 'manual', reason: null, action: null }, defaults: { model: null, effort: null, mode: null } });
  globalThis.fetch = async () => ++reads === 1 ? oldResponse : Response.json({ harnesses: [entry('new-host')] });
  try {
    await act(async () => root.render(<I18nProvider><HarnessRuntimeSettings /></I18nProvider>));
    await act(async () => switchRuntimeEndpoint({ apiBaseUrl: 'https://harness-other.example', runtimeKey: 'harness-other' }));
    expect(dom.container.textContent).toContain('new-host');
    await act(async () => releaseOld(Response.json({ harnesses: [entry('old-host')] })));
    expect(dom.container.textContent).not.toContain('old-host');
  } finally { await act(async () => root.unmount()); switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: '' }); globalThis.fetch = originalFetch; dom.restore(); }
});

test('native updates require confirmation, block duplicate clicks and retain the known version on failure', async () => {
  const dom = installDom();
  const root = createRoot(dom.container);
  const originalFetch = globalThis.fetch;
  const requests: Array<{ path: string; body?: string }> = [];
  let releaseUpdate: (response: Response) => void = () => undefined;
  const waiting = new Promise<Response>((resolve) => { releaseUpdate = resolve; });
  const harness = { id: 'claude', installed: true, running: false, version: '1.0', latestVersion: '2.0', checkError: null, update: { status: 'available', reason: null, action: 'claude update' }, defaults: { model: null, effort: null, mode: null } };
  globalThis.fetch = async (input, init) => {
    requests.push({ path: String(input), body: init?.body ? String(init.body) : undefined });
    if (String(input).endsWith('/update')) return waiting;
    return Response.json({ harnesses: [harness] });
  };
  try {
    await act(async () => root.render(<I18nProvider><HarnessRuntimeSettings /></I18nProvider>));
    const update = [...dom.container.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Install update');
    if (!update) throw new Error('Native update action missing');
    await act(async () => { update.click(); update.click(); });
    expect(requests.filter((request) => request.path.endsWith('/update'))).toHaveLength(0);
    const confirmation = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === 'Install update');
    if (!confirmation) throw new Error('Update confirmation missing');
    await act(async () => { confirmation.click(); confirmation.click(); });
    expect(requests.filter((request) => request.path.endsWith('/update'))).toEqual([{ path: '/api/harnesses/claude/update', body: '{"confirm":true}' }]);
    expect(update.disabled).toBe(true);
    await act(async () => releaseUpdate(Response.json({ message: 'update failed' }, { status: 502 })));
    expect(dom.container.textContent).toContain('Update failed. The last known version is shown.');
    expect(dom.container.textContent).toContain('1.0');
  } finally { await act(async () => root.unmount()); globalThis.fetch = originalFetch; dom.restore(); }
});

test('closed engine and native default selectors show labels without opening their portal', async () => {
  const dom = installDom();
  const oldComputedStyle = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: window.getComputedStyle.bind(window) });
  const root = createRoot(dom.container);
  const originalFetch = globalThis.fetch;
  const { HarnessDefaultsSettings } = await import('./HarnessSettings');
  const { switchRuntimeEndpoint } = await import('@/lib/runtime-switch');
  const settings = { defaultHarness: 'codex', codexDefaultModel: 'native-model', codexDefaultEffort: 'high', codexDefaultMode: 'full-access' };
  globalThis.fetch = async (input) => {
    const route = String(input);
    if (route.includes('/api/config/settings')) return Response.json(settings);
    if (route.endsWith('/models')) return Response.json({ models: [{ id: 'native-model', label: 'Native Model Label' }], efforts: [{ id: 'high', label: 'High Effort Label' }], modes: [{ id: 'full-access', label: 'Full access' }], defaultModelId: 'native-model', defaultEffort: 'high', defaultMode: 'full-access' });
    return Response.json({ harnesses: [] });
  };
  try {
    switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: 'closed-selector-test' });
    await act(async () => root.render(<I18nProvider><HarnessDefaultsSettings /></I18nProvider>));
    const text = (anchor: string) => dom.container.querySelector(`[data-settings-item="${anchor}"] [role="combobox"]`)?.textContent;
    expect(text('sessions.default-harness')).toBe('Codex');
    for (const field of ['model', 'effort', 'mode']) expect(text(`sessions.harness-claude-${field}`)).toBe('Use native default');
    expect(text('sessions.harness-codex-model')).toBe('Native Model Label');
    expect(text('sessions.harness-codex-effort')).toBe('High Effort Label');
    expect(text('sessions.harness-codex-mode')).toBe('Full access');
    expect(dom.container.textContent).not.toContain('__native_default__');
    expect(dom.container.querySelectorAll('[role="combobox"][aria-expanded="true"]')).toHaveLength(0);
  } finally { await act(async () => root.unmount()); switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: '' }); globalThis.fetch = originalFetch; if (oldComputedStyle) Object.defineProperty(globalThis, 'getComputedStyle', oldComputedStyle); else Reflect.deleteProperty(globalThis, 'getComputedStyle'); dom.restore(); }
});
