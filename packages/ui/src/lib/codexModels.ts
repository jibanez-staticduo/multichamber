import { z } from 'zod';
import { runtimeFetch } from '@/lib/runtime-fetch';

const optionSchema = z.object({ id: z.string().min(1), label: z.string(), description: z.string().optional() });
const modelSchema = optionSchema.extend({
  supportedReasoningEfforts: z.array(z.object({ reasoningEffort: z.string(), description: z.string() })).optional(),
  defaultReasoningEffort: z.string().nullable().optional(),
});
export const codexModelCatalogSchema = z.object({
  models: z.array(modelSchema),
  defaultModelId: z.string().nullable(),
  efforts: z.array(optionSchema),
  defaultEffort: z.string().nullable(),
  modes: z.array(optionSchema.extend({ isDefault: z.boolean().optional(), dangerous: z.boolean().optional() })),
  defaultMode: z.string().nullable(),
});
export type CodexModelCatalog = z.infer<typeof codexModelCatalogSchema>;
const CODEX_PROVIDER_ID = 'codex';

export function codexModeLabelKey(mode: string) {
  switch (mode) {
    case 'read-only': return 'chat.codexMode.readOnly';
    case 'workspace-write': return 'chat.codexMode.workspace';
    case 'full-access': return 'chat.codexMode.fullAccess';
    default: return null;
  }
}

/** No page-wide cache: each host and model catalog remains authoritative. */
export async function fetchCodexModelCatalog(): Promise<CodexModelCatalog | null> {
  try {
    const response = await runtimeFetch('/api/codex/models');
    if (!response.ok) return null;
    const parsed = codexModelCatalogSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export function codexEffortsForModel(catalog: CodexModelCatalog, modelId: string) {
  const supported = catalog.models.find((model) => model.id === modelId)?.supportedReasoningEfforts;
  return supported ? supported.map((entry) => ({ id: entry.reasoningEffort, label: catalog.efforts.find((option) => option.id === entry.reasoningEffort)?.label ?? entry.reasoningEffort })) : catalog.efforts;
}

export async function selectCodexModel(sessionId: string, pick: { id: string; variant?: string }): Promise<boolean> {
  try {
    return (await runtimeFetch(`/api/session/${encodeURIComponent(sessionId)}/model`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: { providerID: CODEX_PROVIDER_ID, id: pick.id, variant: pick.variant } }),
    })).ok;
  } catch { return false; }
}

export async function selectCodexMode(sessionId: string, mode: string): Promise<boolean> {
  try {
    return (await runtimeFetch(`/api/session/${encodeURIComponent(sessionId)}/codex/mode`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }),
    })).ok;
  } catch { return false; }
}
