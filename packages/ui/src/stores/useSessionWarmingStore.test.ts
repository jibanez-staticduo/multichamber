import { beforeEach, describe, expect, test } from 'bun:test';

import { useSessionWarmingStore } from './useSessionWarmingStore';

describe('session warming store', () => {
  beforeEach(() => useSessionWarmingStore.getState().reset());

  test('refuses native harness sessions before any warming request or state mutation', async () => {
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error('Native session reached warming API'); };
    try {
      for (const id of ['ses_cdx12345678-1234-4234-8234-123456789abc', 'ses_ccc12345678-1234-4234-8234-123456789abc']) {
        await expect(useSessionWarmingStore.getState().setSessionWarm(id, '/repo', true)).rejects.toThrow('OpenCode session');
        await expect(useSessionWarmingStore.getState().setSessionWarm(id, '/repo', false)).rejects.toThrow('OpenCode session');
      }
      expect(requests).toBe(0);
      expect(useSessionWarmingStore.getState().sessions).toEqual({});
    } finally { globalThis.fetch = originalFetch; }
  });

  test('keeps the newest snapshot and ignores an older one that arrives late', () => {
    const { applySnapshot } = useSessionWarmingStore.getState();
    applySnapshot({ revision: 5, enabled: true, minutes: 60, sessions: [{ sessionId: 'ses_a', warmUntil: 100 }, { sessionId: 'ses_b', warmUntil: null }] });
    applySnapshot({ revision: 4, enabled: false, minutes: 60, sessions: [] });

    const state = useSessionWarmingStore.getState();
    expect(state.status).toBe('ready');
    expect(state.enabled).toBe(true);
    expect(state.sessions).toEqual({ ses_a: 100, ses_b: null });
  });

  test('a reset forgets the revision, so the next runtime\'s first snapshot applies', () => {
    const { applySnapshot, reset } = useSessionWarmingStore.getState();
    applySnapshot({ revision: 50, enabled: true, minutes: 60, sessions: [] });
    reset();
    expect(useSessionWarmingStore.getState().status).toBe('loading');
    applySnapshot({ revision: 3, enabled: true, minutes: 60, sessions: [{ sessionId: 'ses_a', warmUntil: null }] });
    expect(useSessionWarmingStore.getState().sessions).toEqual({ ses_a: null });
  });
});
