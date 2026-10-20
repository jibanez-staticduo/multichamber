import { z } from 'zod';
import { runtimeFetch } from './runtime-fetch';

const enginesSchema = z.object({ engines: z.array(z.object({ id: z.string(), available: z.boolean() })) });

/** A successful host response is required; cached catalogs never establish readiness. */
export async function probeNativeHarnessAvailability(): Promise<boolean> {
  const response = await runtimeFetch('/api/engines', { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Engine availability failed (${response.status})`);
  return enginesSchema.parse(await response.json()).engines.some((engine) => engine.available && (engine.id === 'claude' || engine.id === 'codex'));
}
