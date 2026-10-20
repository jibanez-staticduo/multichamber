import React, { act } from 'react';
import { afterEach, expect, test } from 'bun:test';
import { createRoot, installDom } from '@/test-utils/happyDomHarness';
import { useEngineStore } from '@/stores/useEngineStore';
import { SESSION_ENGINE_INFO } from '@/lib/sessionEngine';
import { getRuntimeKey } from '@/lib/runtime-switch';
const oldFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = oldFetch; });

test('the normal new-session action runs directly and does not open the harness menu or model dialog', async () => {
  const dom = installDom();
  const root = createRoot(dom.container);
  globalThis.fetch = async () => Response.json({});
  const { EngineSessionMenu } = await import('./EngineSessionMenu');
  const { I18nProvider } = await import('@/lib/i18n');
  const runtime = getRuntimeKey();
  useEngineStore.setState({ requested: { [runtime]: true }, byRuntime: { [runtime]: { ...SESSION_ENGINE_INFO, claude: { ...SESSION_ENGINE_INFO.claude, available: true }, codex: { ...SESSION_ENGINE_INFO.codex, available: true } } } });
  let calls = 0;
  try {
    await act(async () => root.render(<I18nProvider><EngineSessionMenu directory="/repo" onOpenCode={() => { calls++; }}><button>New session</button></EngineSessionMenu></I18nProvider>));
    const primary = [...dom.container.querySelectorAll('button')].find((button) => button.textContent === 'New session');
    await act(async () => primary?.click());
    expect(calls).toBe(1);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(dom.container.querySelector('button[aria-haspopup="menu"]')?.getAttribute('aria-label')).toBe('Choose session engine');
    expect(dom.container.querySelector('[aria-label="Filter by tool"]')).toBeNull();
  } finally { await act(async () => root.unmount()); dom.restore(); }
});
