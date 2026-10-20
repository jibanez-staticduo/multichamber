// Titles for the chat tabs of the context panel, read across every live
// directory: a chat tab may show a session from another project, so the
// panel's own directory is not enough.
import { nativeSessionLabel } from '@/lib/nativeSessionLabel';
import type { Session } from '@/lib/opencode/model';

type TitledSession = {
  id: string;
  title?: string | null;
  parentID?: string;
  metadata?: Session['metadata'];
  time?: { updated?: number } | null;
};

type SessionSlice = {
  session: readonly TitledSession[];
};

export const EMPTY_SESSION_TITLE_MAP: ReadonlyMap<string, string> = new Map<string, string>();

export const areTitleMapsEqual = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean => {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
};

const getSessionUpdatedAt = (session: TitledSession): number => {
  const updatedAt = session.time?.updated;
  return typeof updatedAt === 'number' && Number.isFinite(updatedAt) ? updatedAt : 0;
};

// A project's store also holds its worktrees' sessions, so one session can
// appear in more than one store; the most recently updated copy wins, like
// findLiveSession does for the session itself.
export const buildSessionTitleMap = (states: Iterable<SessionSlice>, sessionIDs: readonly string[], untitled = ''): ReadonlyMap<string, string> => {
  if (sessionIDs.length === 0) return EMPTY_SESSION_TITLE_MAP;
  const wanted = new Set(sessionIDs);
  const updatedAtById = new Map<string, number>();
  const qualityById = new Map<string, number>();
  const next = new Map<string, string>();
  for (const state of states) {
    for (const session of state.session) {
      if (!wanted.has(session.id)) continue;
      const title = nativeSessionLabel({ ...session, title: session.title ?? '' }, untitled);
      if (!title) continue;
      const updatedAt = getSessionUpdatedAt(session);
      const rawTitle = session.title?.trim() || '';
      const generic = !rawTitle || rawTitle === 'Untitled session' || rawTitle === untitled;
      const quality = generic ? (title !== (rawTitle || untitled) ? 1 : 0) : 2;
      const seenAt = updatedAtById.get(session.id);
      if (seenAt !== undefined && seenAt > updatedAt) continue;
      if (seenAt === updatedAt && (qualityById.get(session.id) ?? 0) > quality) continue;
      updatedAtById.set(session.id, updatedAt);
      qualityById.set(session.id, quality);
      next.set(session.id, title);
    }
  }
  return next.size === 0 ? EMPTY_SESSION_TITLE_MAP : next;
};

/** The session a chat tab shows, from its `session:<id>` dedupe key. */
export const getSessionIDFromDedupeKey = (dedupeKey: string | undefined): string | null => {
  if (!dedupeKey || !dedupeKey.startsWith('session:')) {
    return null;
  }

  const sessionID = dedupeKey.slice('session:'.length).trim();
  return sessionID || null;
};

/** Keep restored chat tabs useful after their session's live store is evicted. */
export function refreshChatTabTitles<T extends { mode: string; dedupeKey: string; label: string | null; sessionTitleFallback: string | null }>(tabs: T[], titles: ReadonlyMap<string, string>): T[] {
  let changed = false;
  const next = tabs.map((tab) => {
    const id = tab.mode === 'chat' ? getSessionIDFromDedupeKey(tab.dedupeKey) : null;
    const title = id ? titles.get(id) : undefined;
    if (!title || (tab.label === title && tab.sessionTitleFallback === title)) return tab;
    changed = true;
    return { ...tab, label: title, sessionTitleFallback: title };
  });
  return changed ? next : tabs;
}
