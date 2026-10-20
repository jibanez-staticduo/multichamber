import express from 'express';
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createHarnessManager } from './runtime.js';
import { createDefaultsValidator, registerHarnessRoutes } from './routes.js';
import { configureSessionHarnesses, withSessionHarnesses } from './session-client.js';

const catalog = { models: [{ id: 'native', supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }], defaultModelId: 'native', defaultEffort: 'high', defaultMode: 'full-access', modes: [{ id: 'full-access' }], efforts: [{ id: 'high' }] };
const fixture = ({ fetchImpl = async () => new Response(JSON.stringify({ version: '2.0.0' })), busy = false } = {}) => {
  const commands = [];
  const surface = { getCatalog: async () => catalog, runtime: { resolveExecutable: async () => '/custom/claude', ensureAvailable: async () => true }, listClaudeActive: async () => busy ? { session: { type: 'busy' } } : {} };
  const manager = createHarnessManager({
    claudeSurface: surface, codexSurface: surface, readSettings: async () => ({}), env: { PATH: '/custom', OPENCHAMBER_CODEX_BINARY: '/custom/codex' }, fetchImpl,
    fileSystem: { access: async () => {}, realpath: async (value) => value, readFile: async () => { throw new Error('not a package'); } },
    executeCommand: async (binary, args) => { commands.push({ binary, args }); return '1.0.0'; },
    openCode: { describe: async () => ({ version: '2.0.0', running: true }), capability: () => ({ supported: false, reason: 'external' }), isBusy: async () => false },
  });
  const app = express();
  registerHarnessRoutes(app, { manager, express, validateDefaults: createDefaultsValidator({ claudeSurface: surface, codexSurface: surface }) });
  return { app, manager, commands };
};
describe('harness management', () => {
  it('reports all three harnesses and checks official versions without running an update', async () => {
    const f = fixture();
    expect((await request(f.app).get('/api/harnesses')).body.harnesses.map((entry) => entry.id)).toEqual(['opencode', 'claude', 'codex']);
    const checked = await request(f.app).post('/api/harnesses/codex/check').expect(200);
    expect(checked.body).toMatchObject({ id: 'codex', installed: true, running: true, latestVersion: '2.0.0', update: { status: 'manual', reason: 'shared-authority' }, defaults: { model: 'native', effort: 'high' } });
    expect(f.commands.every((command) => command.args[0] === '--version')).toBe(true);
  });
  it('requires explicit confirmation and never updates an unknown or shared installation', async () => {
    const f = fixture();
    await request(f.app).post('/api/harnesses/codex/update').send({}).expect(400);
    await request(f.app).post('/api/harnesses/codex/update').send({ confirm: true }).expect(409);
    expect(f.commands.every((command) => command.args[0] === '--version')).toBe(true);
  });
  it('exposes a failed version check without replacing known installed facts', async () => {
    const f = fixture({ fetchImpl: async () => new Response('', { status: 503 }) });
    const result = await f.manager.check('claude');
    expect(result.installed).toBe(true);
    expect(result.version).toBe('1.0.0');
    expect(result.latestVersion).toBeNull();
    expect(result.checkError).toContain('503');
  });
  it('validates explicit defaults but permits clearing them without a provider request', async () => {
    let calls = 0;
    const surface = { getCatalog: async () => { calls += 1; return catalog; } };
    const validate = createDefaultsValidator({ claudeSurface: surface, codexSurface: surface });
    await validate({ codexDefaultModel: '', codexDefaultEffort: '' });
    expect(calls).toBe(0);
    await expect(validate({ codexDefaultModel: 'missing' })).rejects.toThrow('Unknown codex model');
    await expect(validate({ codexDefaultEffort: 'low' })).rejects.toThrow('Unsupported codex effort');
    await expect(validate({ codexDefaultMode: 'unknown' })).rejects.toThrow('Unknown codex mode');
  });
  it('returns engine-scoped snapshots without claiming OpenCode completeness and preserves read failures', async () => {
    const f = fixture();
    const app = express();
    registerHarnessRoutes(app, { manager: f.manager, express, validateDefaults: async () => {}, nativeSurfaces: { codex: { list: async () => [{ id: 'native' }], active: async () => { throw new Error('native state unavailable'); }, pending: async () => [] } } });
    expect((await request(app).get('/api/harnesses/codex/sessions').expect(200)).body).toEqual({ data: [{ id: 'native' }], cursor: { previous: null, next: null }, harness: 'codex' });
    expect((await request(app).get('/api/harnesses/codex/active').expect(502)).body.message).toBe('native state unavailable');
    await request(app).get('/api/harnesses/opencode/sessions').expect(400);
  });
});

it('routes foreign session reads to their owner and refuses unsupported mutations before calling OpenCode', async () => {
  let upstream = 0;
  const ownId = 'ses_cdxfixture';
  configureSessionHarnesses((id) => id === ownId ? { sessionClient: { get: async () => ({ id }), messages: async () => ({ data: [{ id: 'message' }], cursor: {} }) } } : null);
  const client = withSessionHarnesses({ session: { get: async () => { upstream += 1; return {}; }, update: async () => { upstream += 1; }, message: { get: async () => {} } }, message: { list: async () => { upstream += 1; return {}; } } });
  try {
    expect(await client.session.get({ sessionID: ownId })).toEqual({ id: ownId });
    expect((await client.message.list({ sessionID: ownId })).data).toHaveLength(1);
    expect(() => client.session.update({ sessionID: ownId })).toThrow('does not support');
    expect(upstream).toBe(0);
  } finally { configureSessionHarnesses(() => null); }
});

it('keeps native sessions in complete backfill lists and propagates missing native authority', async () => {
  const native = { id: 'ses_cdxfixture' };
  configureSessionHarnesses(() => null, async () => [native]);
  const client = withSessionHarnesses({ session: { list: async () => ({ data: [{ id: 'ses_open' }], cursor: { next: null } }) }, message: {} });
  try {
    expect((await client.session.list({ parentID: null })).data.map((entry) => entry.id)).toEqual(['ses_open', native.id]);
    expect((await client.session.list({ cursor: 'next' })).data).toEqual([{ id: 'ses_open' }]);
    configureSessionHarnesses(() => null, async () => { throw new Error('Native listing failed'); });
    await expect(client.session.list({ parentID: null })).rejects.toThrow('Native listing failed');
  } finally { configureSessionHarnesses(() => null); }
});

it('runs a known native Claude updater only after confirmation and when idle', async () => {
  const commands = [];
  let version = '1.0.0';
  const native = path.join(os.homedir(), '.local/share/claude/versions/1.0.0');
  const launcher = path.join(os.homedir(), '.local/bin/claude');
  const manager = createHarnessManager({
    claudeSurface: { runtime: { resolveExecutable: async () => launcher }, getCatalog: async () => catalog, listClaudeActive: async () => ({}) },
    readSettings: async () => ({}),
    fileSystem: { realpath: async () => native, readFile: async () => { throw new Error('no package'); } },
    executeCommand: async (binary, args) => { commands.push({ binary, args }); if (args[0] === 'update') version = '2.0.0'; return version; },
    fetchImpl: async () => Response.json({ version: '2.0.0' }),
  });
  const result = await manager.update('claude');
  expect(result.status).toBe('updated');
  expect(commands.filter((command) => command.args[0] === 'update')).toEqual([{ binary: launcher, args: ['update'] }]);
});

it('locks an update before asynchronous checks and refuses unverified post-update versions', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let descriptions = 0;
  let updates = 0;
  const manager = createHarnessManager({
    readSettings: async () => ({}), fetchImpl: async () => Response.json({ version: '2.0.0' }),
    openCode: { describe: async () => { descriptions += 1; if (descriptions === 1) await gate; return { version: descriptions === 1 ? '1.0.0' : null, running: true }; }, capability: () => ({ supported: true }), isBusy: async () => false, update: async () => { updates += 1; } },
  });
  const first = manager.update('opencode');
  await expect(manager.update('opencode')).rejects.toThrow('already running');
  release();
  await expect(first).rejects.toThrow('does not match');
  expect(updates).toBe(1);
});
