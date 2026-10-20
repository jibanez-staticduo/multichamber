import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { createRoot, installDom } from '@/test-utils/happyDomHarness';

test('each authoritative Codex child link opens its own session on mobile and desktop', async () => {
  const dom = installDom();
  const root = createRoot(dom.container);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  const { OpenSubtaskButton } = await import('./OpenSubtaskButton');
  const { I18nProvider } = await import('@/lib/i18n');
  const { useDirectoryStore } = await import('@/stores/useDirectoryStore');
  const { useSessionUIStore } = await import('@/sync/session-ui-store');
  const { useUIStore } = await import('@/stores/useUIStore');
  useDirectoryStore.setState({ currentDirectory: '/repo' });
  useSessionUIStore.setState({ currentSessionId: null, newSessionDraft: undefined });
  const mobileVisits: string[] = [];
  const desktopVisits: string[] = [];
  const oldSetCurrentSession = useSessionUIStore.getState().setCurrentSession;
  const oldOpenTab = useUIStore.getState().openContextPanelTab;
  useSessionUIStore.setState({ setCurrentSession: (id) => { if (id) mobileVisits.push(id); } });
  useUIStore.setState({ openContextPanelTab: (_directory, tab) => { desktopVisits.push(tab.dedupeKey ?? ''); } });
  const render = (mobile: boolean) => <I18nProvider>{['ses_cdxone', 'ses_cdxtwo'].map((sessionId) => <OpenSubtaskButton key={sessionId} directory="/repo" isMobile={mobile} agent="subagent" sessionId={sessionId} />)}</I18nProvider>;
  try {
    await act(async () => root.render(render(true)));
    const buttons = [...dom.container.querySelectorAll('button')];
    expect(buttons).toHaveLength(2);
    await act(async () => { buttons[1].click(); buttons[0].click(); });
    expect(mobileVisits).toEqual(['ses_cdxtwo', 'ses_cdxone']);
    await act(async () => root.render(render(false)));
    await act(async () => { [...dom.container.querySelectorAll('button')][1].click(); });
    expect(desktopVisits).toEqual(['session:ses_cdxtwo']);
  } finally {
    await act(async () => root.unmount());
    useSessionUIStore.setState({ setCurrentSession: oldSetCurrentSession });
    useUIStore.setState({ openContextPanelTab: oldOpenTab });
    globalThis.fetch = originalFetch;
    dom.restore();
  }
});
