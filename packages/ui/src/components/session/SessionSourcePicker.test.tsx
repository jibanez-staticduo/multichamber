import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { createRoot, installDom } from '@/test-utils/happyDomHarness';

test('icon filters keep localized accessible names and select each source without text overflow', async () => {
  const dom = installDom();
  const root = createRoot(dom.container);
  const { SessionSourcePicker } = await import('./SessionSourcePicker');
  const { I18nProvider } = await import('@/lib/i18n');
  const { useSessionSourceFilterStore } = await import('@/stores/useSessionSourceFilterStore');
  const original = useSessionSourceFilterStore.getState().filter;
  try {
    useSessionSourceFilterStore.getState().setFilter('all');
    await act(async () => root.render(<I18nProvider><SessionSourcePicker /></I18nProvider>));
    const buttons = [...dom.container.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['All tools', 'opencode', 'Claude Code', 'Codex']);
    expect(buttons.every((button) => button.textContent === '')).toBe(true);
    expect(dom.container.querySelector('[role="group"]')?.className).not.toContain('overflow-x');
    const sources = ['all', 'opencode', 'claude', 'codex'] as const;
    for (const [index, source] of sources.entries()) {
      await act(async () => { buttons[index].click(); });
      expect(useSessionSourceFilterStore.getState().filter).toBe(source);
      expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(sources.map((candidate) => String(candidate === source)));
    }
    expect(buttons[2].querySelector('img')?.getAttribute('src')).toContain('claude-code.svg');
    expect(buttons[3].querySelector('img')?.getAttribute('src')).toContain('openai.svg');
  } finally {
    await act(async () => root.unmount());
    useSessionSourceFilterStore.getState().setFilter(original);
    dom.restore();
  }
});
