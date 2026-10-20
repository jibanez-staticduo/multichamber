import { afterEach, describe, expect, test } from 'bun:test';
import { codexModeLabelKey, codexEffortsForModel, codexModelCatalogSchema, fetchCodexModelCatalog, selectCodexMode, selectCodexModel } from './codexModels';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const catalog = {
  models: [{ id: 'sol', label: 'Sol', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }], defaultReasoningEffort: 'medium' }],
  defaultModelId: 'sol', efforts: [{ id: 'medium', label: 'Medium' }, { id: 'high', label: 'High' }], defaultEffort: 'medium',
  modes: [{ id: 'read-only', label: 'Read only' }], defaultMode: 'read-only',
};
describe('Codex catalog and selection', () => {
  test('parses catalogs and only offers the selected model reasoning efforts', () => {
    expect(codexModelCatalogSchema.safeParse(catalog).success).toBe(true);
    expect(codexEffortsForModel(catalog, 'sol')).toEqual([{ id: 'medium', label: 'Medium' }]);
    expect(codexModelCatalogSchema.safeParse({ ...catalog, models: [{}] }).success).toBe(false);
  });
  test('a failed catalog is distinct from a successful empty catalog', async () => {
    globalThis.fetch = async () => new Response('offline', { status: 503 });
    expect(await fetchCodexModelCatalog()).toBeNull();
    globalThis.fetch = async () => Response.json({ ...catalog, models: [] });
    expect((await fetchCodexModelCatalog())?.models).toEqual([]);
  });
  test('each fetch reads the current runtime instead of reusing a page-wide catalog', async () => {
    let requests = 0;
    globalThis.fetch = async () => { requests++; return Response.json(catalog); };
    await fetchCodexModelCatalog(); await fetchCodexModelCatalog();
    expect(requests).toBe(2);
  });
  test('sends Codex model, reasoning and mode through their owning routes', async () => {
    const requests: { url: string; body: string }[] = [];
    globalThis.fetch = async (input, init) => { requests.push({ url: String(input), body: String(init?.body) }); return Response.json({}); };
    expect(await selectCodexModel('ses_cdx123', { id: 'sol', variant: 'high' })).toBe(true);
    expect(await selectCodexMode('ses_cdx123', 'workspace-write')).toBe(true);
    expect(requests).toEqual([
      { url: '/api/session/ses_cdx123/model', body: JSON.stringify({ model: { providerID: 'codex', id: 'sol', variant: 'high' } }) },
      { url: '/api/session/ses_cdx123/codex/mode', body: JSON.stringify({ mode: 'workspace-write' }) },
    ]);
  });
  test('rejected selections report failure', async () => {
    globalThis.fetch = async () => new Response('', { status: 400 });
    expect(await selectCodexModel('ses_cdx123', { id: 'bad' })).toBe(false);
    expect(await selectCodexMode('ses_cdx123', 'bad')).toBe(false);
  });
});


test('permission mode labels map only recognized native mode ids', () => {
  expect(codexModeLabelKey('read-only')).toBe('chat.codexMode.readOnly');
  expect(codexModeLabelKey('workspace-write')).toBe('chat.codexMode.workspace');
  expect(codexModeLabelKey('full-access')).toBe('chat.codexMode.fullAccess');
  expect(codexModeLabelKey('future-native-mode')).toBeNull();
});
