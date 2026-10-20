import { z } from 'zod';
import { runtimeFetch } from '@/lib/runtime-fetch';

export const harnessIdSchema = z.enum(['opencode', 'claude', 'codex']);
export type HarnessId = z.infer<typeof harnessIdSchema>;
const harnessSchema = z.object({
  id: harnessIdSchema,
  installed: z.boolean(), running: z.boolean(),
  version: z.string().nullable(), latestVersion: z.string().nullable(), checkError: z.string().nullable(),
  update: z.object({ status: z.enum(['available', 'current', 'manual', 'unsupported', 'unknown']), reason: z.string().nullable(), action: z.string().nullable() }),
  defaults: z.object({ model: z.string().nullable(), effort: z.string().nullable(), mode: z.string().nullable() }),
});
export const harnessesSchema = z.object({ harnesses: z.array(harnessSchema) });
export type HarnessStatus = z.infer<typeof harnessSchema>;
const nativeCatalogSchema = z.object({
  models: z.array(z.object({ id: z.string(), label: z.string(), supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string() })).optional() })),
  efforts: z.array(z.object({ id: z.string(), label: z.string() })),
  modes: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
  defaultModelId: z.string().nullable(), defaultEffort: z.string().nullable(), defaultMode: z.string().nullable().optional(),
});
export type NativeCatalog = z.infer<typeof nativeCatalogSchema>;

export async function readHarnesses(): Promise<HarnessStatus[]> {
  const response = await runtimeFetch('/api/harnesses');
  if (!response.ok) throw new Error(`Harness status: HTTP ${response.status}`);
  return harnessesSchema.parse(await response.json()).harnesses;
}
export async function checkHarness(id: HarnessId): Promise<HarnessStatus> {
  const response = await runtimeFetch(`/api/harnesses/${id}/check`, { method: 'POST' });
  if (!response.ok) throw new Error(`Harness update check: HTTP ${response.status}`);
  return harnessSchema.parse(await response.json());
}
const harnessUpdateSchema = z.object({ status: z.enum(['updated', 'manual', 'unsupported']), message: z.string(), harness: harnessSchema });
export async function updateHarness(id: 'claude' | 'codex') {
  const response = await runtimeFetch(`/api/harnesses/${id}/update`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }),
  });
  const result = harnessUpdateSchema.safeParse(await response.json());
  if (!result.success || (!response.ok && response.status !== 409)) throw new Error('Harness update failed');
  return result.data;
}
export async function readNativeCatalog(id: 'claude' | 'codex'): Promise<NativeCatalog> {
  const response = await runtimeFetch(`/api/${id}/models`);
  if (!response.ok) throw new Error(`Model catalog: HTTP ${response.status}`);
  return nativeCatalogSchema.parse(await response.json());
}
export const harnessSettingKeys = {
  claude: { model: 'claudeDefaultModel', effort: 'claudeDefaultEffort', mode: 'claudeDefaultMode' },
  codex: { model: 'codexDefaultModel', effort: 'codexDefaultEffort', mode: 'codexDefaultMode' },
} as const;
