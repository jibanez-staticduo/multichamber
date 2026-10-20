import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { OpenCode } from '@opencode/client';
import { createRoot, installDom } from '@/test-utils/happyDomHarness';
import type { Session } from '@/lib/opencode/model';

const directory = '/codex-mode-test';
const sessionId = 'ses_cdxmode-test';
const session = (mode?: string): Session => ({ id: sessionId, projectID: 'project', directory, title: 'Mode', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, updated: 1 }, metadata: { backend: 'codex', codex: mode ? { mode } : {} } });

test('existing unknown permissions never inherit the creation default; native read-only and refused changes stay truthful', async () => {
  const dom = installDom();
  const root = createRoot(dom.container);
  const { SyncProvider } = await import('@/sync/sync-context');
  const { getSyncChildStores } = await import('@/sync/sync-refs');
  const { I18nProvider } = await import('@/lib/i18n');
  const { CodexModelControls } = await import('./CodexModelControls');
  const oldFetch = globalThis.fetch;
  const oldStyle = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: window.getComputedStyle.bind(window) });
  const requests: string[] = [];
  globalThis.fetch = async (input) => {
    const target = String(input); requests.push(target);
    if (target.endsWith('/api/codex/models')) return Response.json({ models: [{ id: 'sol', label: 'Sol' }], efforts: [], modes: [{ id: 'read-only', label: 'Read only' }, { id: 'full-access', label: 'Full access' }], defaultModelId: 'sol', defaultEffort: null, defaultMode: 'full-access' });
    if (target.endsWith('/codex/mode')) return new Response('', { status: 409 });
    return Response.json({ data: [], cursor: { previous: null, next: null } });
  };
  const sdk = OpenCode.make({ baseUrl: 'http://codex-mode.test', fetch: () => new Promise<Response>(() => undefined) });
  try {
    await act(async () => root.render(<I18nProvider><SyncProvider sdk={sdk} directory={directory}><CodexModelControls sessionId={sessionId} directory={directory} /></SyncProvider></I18nProvider>));
    const store = getSyncChildStores().getChild(directory);
    if (!store) throw new Error('Session store missing');
    await act(async () => store.setState({ session: [session()] }));
    const trigger = () => dom.container.querySelector<HTMLButtonElement>('[aria-label="Permission mode"]');
    expect(trigger()?.textContent).toBe('unknown');
    expect(trigger()?.textContent).not.toBe('Full access');
    await act(async () => store.setState({ session: [session('read-only')] }));
    expect(trigger()?.textContent).toBe('Read only');
    await act(async () => trigger()?.click());
    const fullAccess = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent === 'Full access');
    if (!fullAccess) throw new Error('Mode option missing');
    await act(async () => fullAccess.click());
    expect(requests.filter((target) => target.endsWith('/codex/mode'))).toHaveLength(1);
    expect(trigger()?.textContent).toBe('Read only');
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = oldFetch;
    if (oldStyle) Object.defineProperty(globalThis, 'getComputedStyle', oldStyle); else Reflect.deleteProperty(globalThis, 'getComputedStyle');
    dom.restore();
  }
});
