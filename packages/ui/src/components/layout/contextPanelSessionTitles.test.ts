import { describe, expect, test } from 'bun:test';

import { areTitleMapsEqual, buildSessionTitleMap, EMPTY_SESSION_TITLE_MAP, refreshChatTabTitles } from './contextPanelSessionTitles';

const state = (...session: Array<{ id: string; title?: string | null; updated?: number }>) => ({
  session: session.map(({ updated, ...rest }) => ({ ...rest, time: updated === undefined ? undefined : { updated } })),
});

describe('context panel session titles', () => {
  test('replaces a restored generic tab fallback after identity arrives and retains it after store eviction', () => {
    const id = 'ses_cdx01a157a9-e97c-7742-ab21-4285c6a695c8';
    const tabs = [{ mode: 'chat', dedupeKey: `session:${id}`, label: 'Untitled session', sessionTitleFallback: 'Untitled session', targetDirectory: '/other/project', readOnly: true }];
    const titles = buildSessionTitleMap([{ session: [{ id, parentID: 'ses_cdxparent', title: 'Untitled session', metadata: { backend: 'codex', codex: { agentNickname: 'Volta', agentPath: '/root/code_reviewer' } } }] }], [id]);
    const refreshed = refreshChatTabTitles(tabs, titles);
    expect(refreshed[0]).toEqual({ ...tabs[0], label: 'Volta (/root/code_reviewer)', sessionTitleFallback: 'Volta (/root/code_reviewer)' });
    expect(refreshChatTabTitles(refreshed, new Map())).toBe(refreshed);
    expect(refreshChatTabTitles(refreshed, titles)).toBe(refreshed);
  });
  test('resolves the real Codex child identity on metadata arrival without an updated timestamp change', () => {
    const id = 'ses_cdx01a157a9-e97c-7742-ab21-4285c6a695c8';
    const stale = { id, parentID: 'ses_cdxparent', title: 'Untitled session', time: { updated: 7 }, metadata: { backend: 'codex' } };
    const resolved = { ...stale, metadata: { backend: 'codex', codex: { agentNickname: 'Volta', agentPath: '/root/code_reviewer', agentRole: 'reviewer' } } };
    const before = buildSessionTitleMap([{ session: [stale] }], [id], 'Untitled Session');
    const after = buildSessionTitleMap([{ session: [stale] }, { session: [resolved] }], [id], 'Untitled Session');
    const reversed = buildSessionTitleMap([{ session: [resolved] }, { session: [stale] }], [id], 'Untitled Session');
    expect(before.get(id)).toBe('Untitled session');
    expect(after.get(id)).toBe('Volta (/root/code_reviewer)');
    expect(reversed.get(id)).toBe(after.get(id));
    expect(areTitleMapsEqual(before, after)).toBe(false);
    expect(buildSessionTitleMap([{ session: [{ ...resolved, title: 'Review permissions' }] }], [id]).get(id)).toBe('Review permissions');
    expect(buildSessionTitleMap([{ session: [resolved] }, { session: [{ ...resolved, title: 'Review permissions' }] }], [id], 'Untitled Session').get(id)).toBe('Review permissions');
    expect(buildSessionTitleMap([{ session: [{ ...resolved, title: 'Review permissions' }] }, { session: [resolved] }], [id], 'Untitled Session').get(id)).toBe('Review permissions');
    expect(buildSessionTitleMap([{ session: [{ ...resolved, parentID: undefined }] }], [id]).get(id)).toBe('Untitled session');
  });
  test('reads a chat tab title from whichever live directory holds the session', () => {
    const titles = buildSessionTitleMap(
      [state({ id: 'ses_a', title: 'Main chat' }), state({ id: 'ses_b', title: 'Other project' })],
      ['ses_a', 'ses_b'],
    );

    expect(titles.get('ses_a')).toBe('Main chat');
    expect(titles.get('ses_b')).toBe('Other project');
  });

  test('follows a rename and leaves a session without a title to its fallback', () => {
    const states = [state({ id: 'ses_a', title: 'Main chat' }), state({ id: 'ses_b', title: '  ' }, { id: 'ses_c', title: 'Not a tab' })];
    const before = buildSessionTitleMap(states, ['ses_a', 'ses_b']);
    const after = buildSessionTitleMap([states[0]!, state({ id: 'ses_b', title: 'Renamed' })], ['ses_a', 'ses_b']);

    expect(before.has('ses_b')).toBe(false);
    expect(before.has('ses_c')).toBe(false);
    expect(after.get('ses_b')).toBe('Renamed');
    expect(areTitleMapsEqual(before, after)).toBe(false);
    expect(areTitleMapsEqual(before, buildSessionTitleMap(states, ['ses_a', 'ses_b']))).toBe(true);
  });

  test('prefers the most recently updated copy when a session sits in two stores', () => {
    const titles = buildSessionTitleMap(
      [state({ id: 'ses_w', title: 'Stale copy', updated: 1 }), state({ id: 'ses_w', title: 'Fresh copy', updated: 2 })],
      ['ses_w'],
    );
    const reversed = buildSessionTitleMap(
      [state({ id: 'ses_w', title: 'Fresh copy', updated: 2 }), state({ id: 'ses_w', title: 'Stale copy', updated: 1 })],
      ['ses_w'],
    );

    expect(titles.get('ses_w')).toBe('Fresh copy');
    expect(reversed.get('ses_w')).toBe('Fresh copy');
  });

  test('returns the shared empty map when nothing is wanted or found', () => {
    expect(buildSessionTitleMap([state({ id: 'ses_a', title: 'Main chat' })], [])).toBe(EMPTY_SESSION_TITLE_MAP);
    expect(buildSessionTitleMap([state({ id: 'ses_a', title: 'Main chat' })], ['ses_missing'])).toBe(EMPTY_SESSION_TITLE_MAP);
  });
});
