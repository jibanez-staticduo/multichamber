import React from 'react';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { z } from 'zod';
import { codexModelCatalogSchema, codexEffortsForModel } from '@/lib/codexModels';

const claudeSchema = z.object({
  models: z.array(z.object({ id: z.string(), label: z.string() })),
  efforts: z.array(z.object({ id: z.string(), label: z.string() })),
});
type NativeModel = { harness: 'claude' | 'codex'; id: string; label: string; efforts: string[] };

/** Catalogs belong to the currently selected host; a failed host never supplies choices. */
export function useMultiRunNativeCatalog(enabled = true) {
  const runtime = getRuntimeKey();
  const [catalog, setCatalog] = React.useState<{ runtime: string; models: NativeModel[] }>({ runtime: '', models: [] });
  React.useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      const models: NativeModel[] = [];
      await Promise.all(['claude', 'codex'].map(async (harness) => {
        try {
          const response = await runtimeFetch(`/api/${harness}/models`);
          if (!response.ok) return;
          const body = await response.json();
          if (harness === 'claude') {
            const parsed = claudeSchema.safeParse(body);
            if (parsed.success) models.push(...parsed.data.models.map((model) => ({ harness: 'claude' as const, ...model, efforts: parsed.data.efforts.map((effort) => effort.id) })));
          } else {
            const parsed = codexModelCatalogSchema.safeParse(body);
            if (parsed.success) models.push(...parsed.data.models.map((model) => ({ harness: 'codex' as const, ...model, efforts: codexEffortsForModel(parsed.data, model.id).map((effort) => effort.id) })));
          }
        } catch { /* An unavailable engine contributes no selectable models. */ }
      }));
      if (!cancelled && getRuntimeKey() === runtime) setCatalog({ runtime, models });
    };
    void load();
    return () => { cancelled = true; };
  }, [enabled, runtime]);
  return catalog.runtime === runtime ? catalog.models : [];
}
