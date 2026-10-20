import { z } from 'zod';
import type { Session } from './opencode/model';
import { resolveSessionEngine } from './sessionEngine';

const identity = z.object({ codex: z.object({ agentNickname: z.string().nullish(), agentPath: z.string().nullish(), agentRole: z.string().nullish() }) });

/** Native identity is a display fallback for untitled children, never a persisted rename. */
export function nativeSessionLabel(session: Pick<Session, 'id' | 'parentID' | 'title' | 'metadata'>, untitled: string): string {
  const title = session.title.trim();
  if (!session.parentID || resolveSessionEngine(session) !== 'codex' || (title && title !== 'Untitled session' && title !== untitled)) return title || untitled;
  const parsed = identity.safeParse(session.metadata);
  if (!parsed.success) return title || untitled;
  const native = parsed.data.codex;
  const nickname = native.agentNickname?.trim();
  const path = native.agentPath?.trim();
  const role = native.agentRole?.trim();
  if (nickname && path) return `${nickname} (${path})`;
  return path || nickname || role || title || untitled;
}
