import { afterEach, expect, test } from 'bun:test';
import { checkHarness, harnessesSchema, harnessSettingKeys, readHarnesses, readNativeCatalog } from './harnesses';
import { parseSettingsDocument } from './registry';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const status = { id: 'codex', installed: true, running: true, version: '0.163.0', latestVersion: null, checkError: null, update: { status: 'manual', reason: 'shared-authority', action: 'codex upgrade' }, defaults: { model: 'sol', effort: 'medium', mode: 'full-access' } };

test('harness preferences persist independently and reject invalid engine ids', () => {
  const parsed = parseSettingsDocument({ defaultHarness: 'codex', defaultModel: 'openai/gpt', claudeDefaultModel: 'opus', codexDefaultModel: 'sol', codexDefaultEffort: 'high', codexDefaultMode: 'full-access' });
  expect(parsed).toMatchObject({ defaultHarness: 'codex', defaultModel: 'openai/gpt', claudeDefaultModel: 'opus', codexDefaultModel: 'sol', codexDefaultEffort: 'high', codexDefaultMode: 'full-access' });
  expect(parseSettingsDocument({ defaultHarness: 'other' })?.defaultHarness).toBeUndefined();
  expect(harnessSettingKeys.claude.model).not.toBe(harnessSettingKeys.codex.model);
});
test('status and update checks use explicit runtime routes and never run an update', async () => {
  const requests: Array<{ path: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ path: String(input), method: init?.method ?? 'GET' });
    return Response.json(init?.method === 'POST' ? status : { harnesses: [status] });
  };
  expect((await readHarnesses())[0].update.status).toBe('manual');
  expect((await checkHarness('codex')).version).toBe('0.163.0');
  expect(requests).toEqual([{ path: '/api/harnesses', method: 'GET' }, { path: '/api/harnesses/codex/check', method: 'POST' }]);
  expect(harnessesSchema.safeParse({ harnesses: [{ ...status, installed: 'yes' }] }).success).toBe(false);
});
test('failed availability or native catalogs are failures instead of empty catalogs', async () => {
  globalThis.fetch = async () => new Response('', { status: 503 });
  await expect(readHarnesses()).rejects.toThrow();
  await expect(readNativeCatalog('claude')).rejects.toThrow();
});

test('native update results are parsed, and manual ownership remains a refusal to install', async () => {
  const { updateHarness } = await import('./harnesses');
  globalThis.fetch = async () => Response.json({ status: 'updated', message: 'verified', harness: { ...status, version: '2.0.0', update: { ...status.update, status: 'current' } } });
  expect((await updateHarness('claude')).status).toBe('updated');
  globalThis.fetch = async () => Response.json({ status: 'manual', message: 'shared-authority', harness: status }, { status: 409 });
  expect((await updateHarness('codex')).status).toBe('manual');
  globalThis.fetch = async () => Response.json({ status: 'updated', harness: {} });
  await expect(updateHarness('claude')).rejects.toThrow();
});
