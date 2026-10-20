import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { useAutomaticSessionDraft } from './useAutomaticSessionDraft';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useConfigStore } from '@/stores/useConfigStore';
import { useEngineStore } from '@/stores/useEngineStore';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { SESSION_ENGINE_INFO } from '@/lib/sessionEngine';
import { invalidateSettingsCache } from '@/lib/persistence';

test('a cold mobile draft appears when delayed native defaults and catalog arrive without OpenCode', async () => {
  const window = new Window({ url: 'http://localhost' });
  const globals = { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const descriptors = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, globals);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const originalFetch = globalThis.fetch;
  const originalSession = useSessionUIStore.getState();
  const originalConfig = useConfigStore.getState();
  const runtime = getRuntimeKey();
  invalidateSettingsCache();
  globalThis.fetch = async () => Response.json({ defaultHarness: 'codex' });
  useSessionUIStore.setState({ currentSessionId: null, newSessionDraft: { ...originalSession.newSessionDraft, open: false } });
  useConfigStore.setState({ isConnected: false, hasEverConnected: false, settingsDefaultsLoaded: false, nativeReadyRuntimeKey: runtime });
  useEngineStore.setState({ requested: { [runtime]: true }, byRuntime: {} });
  function MobileDraftFixture() {
    useAutomaticSessionDraft(true);
    const draft = useSessionUIStore((state) => state.newSessionDraft);
    return draft.open ? <main>Composer for {draft.harness}</main> : <main>Waiting</main>;
  }
  try {
    await act(async () => root.render(<MobileDraftFixture />));
    expect(container.textContent).toBe('Waiting');
    await act(async () => useConfigStore.setState({ settingsDefaultsLoaded: true }));
    expect(container.textContent).toBe('Waiting');
    await act(async () => {
      useEngineStore.setState({ byRuntime: { [runtime]: { ...SESSION_ENGINE_INFO, codex: { ...SESSION_ENGINE_INFO.codex, available: true } } } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toBe('Composer for codex');
    expect(useConfigStore.getState().isConnected).toBe(false);
    expect(useSessionUIStore.getState().currentSessionId).toBeNull();
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    useSessionUIStore.setState(originalSession);
    useConfigStore.setState(originalConfig);
    invalidateSettingsCache();
    for (const key of Object.keys(globals)) {
      const descriptor = descriptors[key];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
