import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createCodexSurface } from './routes.js';
import { toPublicId } from './wire.js';
import { translateWireEvent } from '../../../../ui/src/lib/opencode/events.ts';

const id = '019a1500-20c1-7000-9000-4296d2ff9517';
const thread = { id, cwd: '/repo/sub', createdAt: 10, updatedAt: 20, model: 'test', status: { type: 'idle' }, name: 'Native title' };
const fixture = (options = {}) => {
  const events = [];
  const calls = [];
  const runtime = {
    ensureAvailable: async () => true,
    list: async ({ archived } = {}) => archived ? [] : [thread],
    active: async () => ({}), pending: () => [],
    read: async () => thread, resume: async () => thread,
    create: async (input) => { calls.push(input); return thread; },
    models: async () => [{ id: 'test', model: 'test', displayName: 'Test model', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Medium' }], defaultReasoningEffort: 'medium' }],
    emit: (type, owner, data) => events.push({ id: 'evt_test', type, created: 1, data }),
    denyPending: () => calls.push('denied'),
    prompt: async (owner, input) => { calls.push(input); return { messageID: input.clientId, created: 1 }; },
    fork: async () => thread,
    dispose: async () => {},
    ...options.runtime,
  };
  const surface = createCodexSurface({ ...options, runtime, isEnterpriseMode: options.enterprise || (() => false), readProjects: async () => [{ id: 'project', worktree: '/repo' }] });
  const app = express();
  surface.register(app);
  app.post('/api/session', (req, res) => res.json({ replayed: req.body }));
  return { app, surface, events, calls };
};

describe('Codex HTTP contract', () => {
  it('preserves creation bodies belonging to another engine', async () => {
    const f = fixture();
    const payload = { metadata: { backend: 'opencode' }, location: { directory: '/repo' }, title: 'hello' };
    const response = await request(f.app).post('/api/session').send(payload);
    expect(response.status).toBe(200);
    expect(response.body.replayed).toEqual(payload);
    expect(f.calls).toEqual([]);
  });
  it('creates in the native directory and emits an official v2 session record', async () => {
    const f = fixture();
    const response = await request(f.app).post('/api/session').send({ metadata: { backend: 'codex' }, location: { directory: '/repo/sub' } });
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ id: toPublicId(id), projectID: 'project', location: { directory: '/repo' }, subpath: 'sub', metadata: { backend: 'codex', codex: { mode: 'full-access' } } });
    expect(translateWireEvent(f.events[0])[0].properties.info.id).toBe(toPublicId(id));
    expect(f.calls[0]).toMatchObject({ directory: '/repo/sub', mode: 'full-access' });
  });
  it('enforces enterprise on every session route and creation/catalog, denies outstanding asks', async () => {
    const f = fixture({ enterprise: () => true });
    for (const endpoint of [`/api/session/${toPublicId(id)}`, '/api/codex/models']) {
      const response = await request(f.app).get(endpoint);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('enterprise_mode');
    }
    expect((await request(f.app).post('/api/session').send({ metadata: { backend: 'codex' }, directory: '/repo' })).status).toBe(403);
    expect((await request(f.app).post(`/api/session/${toPublicId(id)}/prompt`).send({ text: 'hello' })).status).toBe(403);
    expect(f.calls.every((call) => call === 'denied')).toBe(true);
  });
  it('does not silently turn a failed native list into valid empty success', async () => {
    const f = fixture({ runtime: { list: async () => { throw new Error('native history failed'); } } });
    await expect(f.surface.listCodexSessions()).rejects.toThrow('native history failed');
  });
  it('returns explicit unsupported operations and rejects partial fork requests', async () => {
    const f = fixture();
    expect((await request(f.app).post(`/api/session/${toPublicId(id)}/command`).send({ name: 'foo' })).body).toMatchObject({ engine: 'codex', operation: 'command' });
    const response = await request(f.app).post(`/api/session/${toPublicId(id)}/fork`).send({ before: 'msg_a' });
    expect(response.status).toBe(400);
    expect(response.body.operation).toBe('forkAtMessage');
  });
  it('serves native Codex children before the OpenCode fallback and opens a child directly', async () => {
    const childId = '019a1500-20c1-7000-9000-4296d2ff9518';
    const child = { ...thread, id: childId, source: { subAgent: { thread_spawn: { parent_thread_id: id, agent_role: 'reviewer' } } } };
    const lists = [];
    const f = fixture({ runtime: { list: async (options) => { lists.push(options); return options.archived ? [] : [child]; }, resume: async () => child } });
    const children = await request(f.app).get('/api/session').query({ parentID: toPublicId(id) }).expect(200);
    expect(children.body.data).toMatchObject([{ id: toPublicId(childId), parentID: toPublicId(id), metadata: { codex: { agentRole: 'reviewer' } } }]);
    expect(children.body.cursor).toEqual({ previous: null, next: null });
    expect(lists).toEqual([{ parentId: id }, { parentId: id, archived: true }]);
    const detail = await request(f.app).get(`/api/session/${toPublicId(childId)}`).expect(200);
    expect(detail.body.data.parentID).toBe(toPublicId(id));
  });
  it('does not hide child-list errors as empty success and gates enterprise child reads', async () => {
    const failed = fixture({ runtime: { list: async () => { throw new Error('Native child list failed'); } } });
    const failure = await request(failed.app).get('/api/session').query({ parentID: toPublicId(id) }).expect(502);
    expect(failure.body.message).toBe('Native child list failed');
    const blocked = fixture({ enterprise: () => true });
    await request(blocked.app).get('/api/session').query({ parentID: toPublicId(id) }).expect(403);
    const malformed = fixture();
    await request(malformed.app).get('/api/session').query({ parentID: 'ses_cdx../invalid' }).expect(404);
  });
  it('maps live child announcements to the same project and parent as HTTP child reads', async () => {
    const childId = '019a1500-20c1-7000-9000-4296d2ff9518';
    const child = { ...thread, id: childId, source: { subAgent: { thread_spawn: { parent_thread_id: id } } } };
    const events = [];
    let notify;
    const surface = createCodexSurface({
      isEnterpriseMode: () => false,
      readProjects: async () => [{ id: 'project', worktree: '/repo' }],
      publishEvent: ({ payload }) => events.push(payload),
      rpcFactory: (callbacks) => {
        notify = callbacks.onNotification;
        return { request: async () => ({ data: [child], nextCursor: null }), ensureAvailable: async () => true, dispose: async () => {} };
      },
    });
    const app = express();
    surface.register(app);
    const response = await request(app).get('/api/session').query({ parentID: toPublicId(id) }).expect(200);
    notify('thread/started', { thread: child });
    const eventSession = translateWireEvent(events[0])[0].properties.info;
    expect(eventSession).toMatchObject({ id: response.body.data[0].id, parentID: response.body.data[0].parentID, projectID: 'project', directory: '/repo', subpath: 'sub' });
    await surface.dispose();
  });
  it('rejects malformed creation JSON and oversized bodies', async () => {
    const f = fixture();
    expect((await request(f.app).post('/api/session').set('content-type', 'application/json').send('{broken')).status).toBe(400);
    expect((await request(f.app).post('/api/session').send({ text: 'x'.repeat(8 * 1024 * 1024) })).status).toBe(413);
  });
  it('returns native model/effort/mode catalog', async () => {
    const f = fixture();
    const response = await request(f.app).get('/api/codex/models');
    expect(response.body).toMatchObject({ defaultModelId: 'test', defaultMode: 'full-access', efforts: [{ id: 'medium', label: 'medium' }] });
    expect(response.body.modes.map((mode) => mode.id)).toEqual(['read-only', 'workspace-write', 'full-access']);
    expect(response.body.modes.filter((mode) => mode.isDefault).map((mode) => mode.id)).toEqual(['full-access']);
  });
  it('pairs the default effort with the default model when it is not first', async () => {
    const f = fixture({ runtime: { models: async () => [
      { id: 'first', model: 'first', displayName: 'First', supportedReasoningEfforts: [{ reasoningEffort: 'low', description: 'Low' }], defaultReasoningEffort: 'low' },
      { id: 'preferred', model: 'preferred', displayName: 'Preferred', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }], defaultReasoningEffort: 'high' },
    ] } });
    const response = await request(f.app).get('/api/codex/models');
    expect(response.body).toMatchObject({ defaultModelId: 'preferred', defaultEffort: 'high' });
  });
  it('uses saved defaults over native config, then native config over the catalog for catalog and creation', async () => {
    const models = [
      { model: 'first', displayName: 'First', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low' },
      { model: 'native', displayName: 'Native', supportedReasoningEfforts: [{ reasoningEffort: 'high' }], defaultReasoningEffort: 'high' },
    ];
    const native = fixture({ runtime: { models: async () => models, defaults: async () => ({ model: 'native', effort: 'high' }) } });
    expect((await request(native.app).get('/api/codex/models')).body).toMatchObject({ defaultModelId: 'native', defaultEffort: 'high', defaultMode: 'full-access' });
    await request(native.app).post('/api/session').send({ directory: '/repo', metadata: { backend: 'codex' } }).expect(200);
    expect(native.calls[0]).toMatchObject({ model: 'native', effort: 'high', mode: 'full-access' });
    const saved = fixture({ readAppSettings: async () => ({ codexDefaultModel: 'first', codexDefaultEffort: 'low', codexDefaultMode: 'read-only' }), runtime: { models: async () => models, defaults: async () => ({ model: 'native', effort: 'high' }) } });
    await request(saved.app).post('/api/session').send({ directory: '/repo', metadata: { backend: 'codex' } }).expect(200);
    expect(saved.calls[0]).toMatchObject({ model: 'first', effort: 'low', mode: 'read-only' });
  });
  it('delivers native instruction entries before a direct prompt without sending them to OpenCode', async () => {
    const f = fixture();
    await f.surface.sessionClient.putInstruction(toPublicId(id), 'project-pins', 'Pinned note');
    await request(f.app).post(`/api/session/${toPublicId(id)}/prompt`).send({ text: 'hello' }).expect(200);
    expect(f.calls[0]).toMatchObject({ text: 'hello', context: ['Pinned note'] });
    await f.surface.sessionClient.removeInstruction(toPublicId(id), 'project-pins');
    await request(f.app).post(`/api/session/${toPublicId(id)}/prompt`).send({ text: 'again' }).expect(200);
    expect(f.calls[1].context).toEqual([]);
  });
  it('delivers the captured native model and effort for queued work rather than current composer selection', async () => {
    const f = fixture();
    await f.surface.queueTransport.send(toPublicId(id), '/repo', { text: 'scheduled', sendConfig: { providerID: 'codex', modelID: 'test', variant: 'medium' } });
    expect(f.calls[0].selection).toMatchObject({ model: 'test', effort: 'medium' });
    await expect(f.surface.queueTransport.send(toPublicId(id), '/repo', { text: 'bad', sendConfig: { providerID: 'other', modelID: 'test' } })).rejects.toThrow('requires a Codex model');
    expect(f.calls).toHaveLength(1);
  });
  it('forwards explicit steering delivery to the owning runtime', async () => {
    const f = fixture();
    const response = await request(f.app).post(`/api/session/${toPublicId(id)}/prompt`).send({ id: 'msg_steering', text: 'steer', delivery: 'steer' }).expect(200);
    expect(f.calls[0]).toMatchObject({ delivery: 'steer', clientId: 'msg_steering' });
    expect(response.body.data.delivery).toBe('steer');
  });
});
