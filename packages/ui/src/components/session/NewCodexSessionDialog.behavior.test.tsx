import React, { act } from 'react';
import { afterEach, expect, test } from 'bun:test';
import { createRoot, installDom } from '@/test-utils/happyDomHarness';
import { switchRuntimeEndpoint } from '@/lib/runtime-switch';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const catalog = { models: [{ id: 'sol', label: 'Sol' }], defaultModelId: 'sol', efforts: [{ id: 'high', label: 'High' }], defaultEffort: 'high', modes: [{ id: 'read-only', label: 'Read only' }], defaultMode: 'read-only' };

test('catalog failure and a host switch while the dialog is open disable creation', async () => {
  const dom = installDom();
  const root = createRoot(dom.container);
  const requests: string[] = [];
  let failed = false;
  globalThis.fetch = async (input) => {
    const url = String(input); requests.push(url);
    return url.endsWith('/api/codex/models') && !failed ? Response.json(catalog) : new Response('', { status: 503 });
  };
  const { NewCodexSessionDialog } = await import('./NewCodexSessionDialog');
  const { I18nProvider } = await import('@/lib/i18n');
  const render = (open: boolean) => <I18nProvider><NewCodexSessionDialog open={open} directory="/repo" onOpenChange={() => undefined} /></I18nProvider>;
  const createButton = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Create session'));
  try {
    await act(async () => { root.render(render(true)); });
    expect(createButton()?.disabled).toBe(false);
    failed = true;
    await act(async () => {
      switchRuntimeEndpoint({ apiBaseUrl: 'https://codex-host-b.example', runtimeKey: 'codex-host-b' });
      root.render(render(true));
    });
    expect(createButton()?.disabled).toBe(true);
    await act(async () => { createButton()?.click(); });
    expect(requests.some((url) => /\/api\/session$/.test(url))).toBe(false);
    expect(requests.filter((url) => url.endsWith('/api/codex/models')).length).toBe(2);
    expect(requests.some((url) => url.includes('/api/claude/'))).toBe(false);
    await act(async () => { root.render(render(false)); });
    await act(async () => { root.render(render(true)); });
    expect(createButton()?.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: '' });
    dom.restore();
  }
});


test('the mobile creation listener opens the Codex picker and preserves the requesting directory', async () => {
  const dom = installDom();
  const root = createRoot(dom.container);
  const requests: string[] = [];
  globalThis.fetch = async (input) => { requests.push(String(input)); return String(input).endsWith('/api/codex/models') ? Response.json(catalog) : new Response('', { status: 503 }); };
  const { CodexSessionCreationDialogs } = await import('./CodexSessionCreationDialogs');
  const { sessionEvents } = await import('@/lib/sessionEvents');
  const { I18nProvider } = await import('@/lib/i18n');
  try {
    await act(async () => { root.render(<I18nProvider><CodexSessionCreationDialogs /></I18nProvider>); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => { expect(sessionEvents.requestNewCodexSession({ directory: '/mobile-project' })).toBe(true); });
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('/mobile-project');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('New Codex session');
    expect(requests.some((url) => /\/api\/session$/.test(url))).toBe(false);
  } finally { await act(async () => root.unmount()); dom.restore(); }
});

test('permission mode labels use the selected locale while catalog model labels stay native', async () => {
  const dom = installDom();
  const root = createRoot(dom.container);
  const { I18nProvider, useI18nStore } = await import('@/lib/i18n');
  const { dict } = await import('@/lib/i18n/messages/es');
  const initialLocale = useI18nStore.getState();
  let defaultMode = 'read-only';
  globalThis.fetch = async () => Response.json({ ...catalog, defaultMode, modes: [
    { id: 'read-only', label: 'Read only' },
    { id: 'workspace-write', label: 'Workspace' },
    { id: 'full-access', label: 'Full access' },
  ] });
  const { NewCodexSessionDialog } = await import('./NewCodexSessionDialog');
  try {
    useI18nStore.setState({ locale: 'es', dictionary: dict, loadingLocale: null });
    await act(async () => root.render(<I18nProvider><NewCodexSessionDialog open directory="/repo" onOpenChange={() => undefined} /></I18nProvider>));
    const text = document.querySelector('[role="dialog"]')?.textContent;
    expect(text).toContain('Solo lectura');
    expect(text).toContain('Sol');
    expect(text).toContain('High');
    expect(text).not.toContain('Read only');
    expect(text).not.toContain('Full access');
    for (const [id, label] of [['workspace-write', 'Espacio de trabajo'], ['full-access', 'Acceso completo']]) {
      defaultMode = id;
      await act(async () => root.render(<I18nProvider><NewCodexSessionDialog open={false} directory="/repo" onOpenChange={() => undefined} /></I18nProvider>));
      await act(async () => root.render(<I18nProvider><NewCodexSessionDialog open directory="/repo" onOpenChange={() => undefined} /></I18nProvider>));
      expect(document.querySelector('[aria-label="Modo de permisos"]')?.textContent).toContain(label);
    }
  } finally {
    await act(async () => root.unmount());
    useI18nStore.setState(initialLocale, true);
    dom.restore();
  }
});
