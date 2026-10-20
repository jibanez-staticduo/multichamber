import { z } from 'zod';
import type { Session } from '@/lib/opencode/model';
import { getSessionMetadata } from '@/lib/sessionReviewMetadata';

const codexStateSchema = z.object({
  model: z.string().optional(),
  effort: z.string().optional(),
  mode: z.string().optional(),
  contextWindow: z.number().positive().finite().nullable().optional(),
});

export function getCodexEngineState(session: Session | null | undefined) {
  const parsed = codexStateSchema.safeParse(getSessionMetadata(session).codex);
  return parsed.success ? parsed.data : {};
}


const codexContextSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('measured'), tokens: z.number().nonnegative().finite(), window: z.number().positive().finite().nullable() }),
  z.object({ state: z.literal('compacted'), window: z.number().positive().finite().nullable() }),
]);

/** Current request context is distinct from the turn's billable token usage. */
export function readCodexContext(metadata: Session['metadata'] | undefined) {
  const parsed = z.object({ codex: z.object({ context: codexContextSchema.nullable().optional() }) }).safeParse(metadata);
  return parsed.success ? parsed.data.codex.context ?? null : null;
}
