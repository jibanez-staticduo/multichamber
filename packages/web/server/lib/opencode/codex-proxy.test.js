import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { registerOpenCodeProxy } from './proxy.js';

describe('Codex proxy integration', () => {
  const servers = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    })));
  });

  const fixture = async ({ fail = false, failClaude = false, openCodeReady = true } = {}) => {
    const upstream = express();
    upstream.get('/api/session', (_req, res) => res.json({ data: [{ id: 'ses_open', title: 'OpenCode', time: { updated: 1 } }] }));
    upstream.get('/api/session/active', (_req, res) => res.json({ data: { ses_open: { type: 'running' } } }));
    upstream.get('/api/permission/request', (_req, res) => res.json({ data: [] }));
    const server = await new Promise((resolve) => {
      const listening = upstream.listen(0, '127.0.0.1', () => resolve(listening));
    });
    servers.push(server);
    const codexID = 'ses_cdx00000000-0000-4000-8000-000000000001';
    const app = express();
    const codexSurface = {
      register: (target) => target.get(`/api/session/${codexID}`, (_req, res) => res.json({ data: { id: codexID } })),
      listCodexSessions: async () => {
        if (fail) throw new Error('Codex disconnected');
        return [{ id: codexID, title: 'Codex', time: { updated: 2 }, metadata: { backend: 'codex' } }];
      },
      listCodexActive: async () => {
        if (fail) throw new Error('Codex disconnected');
        return { [codexID]: { type: 'busy' } };
      },
      listCodexPending: () => [{ id: 'perm_codex', sessionID: codexID }],
      runtime: { ensureAvailable: async () => true },
    };
    const claudeSurface = failClaude ? {
      register: () => {},
      listClaudeSessions: async () => { throw new Error('Claude history unavailable'); },
      listClaudeActive: async () => { throw new Error('Claude activity unavailable'); },
      listClaudePending: async () => { throw new Error('Claude permissions unavailable'); },
    } : null;
    registerOpenCodeProxy(app, {
      fs: {},
      OPEN_CODE_READY_GRACE_MS: 0,
      getRuntime: () => ({ openCodePort: openCodeReady ? server.address().port : null, isOpenCodeReady: openCodeReady }),
      getOpenCodeAuthHeaders: () => ({}),
      buildOpenCodeUrl: (route) => `http://127.0.0.1:${server.address().port}${route}`,
      ensureOpenCodeApiPrefix: () => {},
      codexSurface,
      claudeSurface,
    });
    return { app, codexID };
  };

  it('merges Codex history only on the first page and routes its IDs before OpenCode', async () => {
    const { app, codexID } = await fixture();
    const list = await request(app).get('/api/session');
    expect(list.status).toBe(200);
    expect(list.body.data.map((session) => session.id)).toEqual([codexID, 'ses_open']);
    const later = await request(app).get('/api/session?cursor=next');
    expect(later.body.data.map((session) => session.id)).toEqual(['ses_open']);
    expect((await request(app).get(`/api/session/${codexID}`)).body.data.id).toBe(codexID);
  });

  it('preserves the wrapped active and permission lists consumed by the SDK', async () => {
    const { app, codexID } = await fixture();
    expect((await request(app).get('/api/session/active')).body).toEqual({ data: {
      ses_open: { type: 'running' }, [codexID]: { type: 'running' },
    } });
    expect((await request(app).get('/api/permission/request')).body.data).toEqual([{ id: 'perm_codex', sessionID: codexID }]);
  });

  it('does not turn failed Codex history or activity reads into authoritative success', async () => {
    const { app } = await fixture({ fail: true });
    expect((await request(app).get('/api/session')).status).toBe(503);
    expect((await request(app).get('/api/session/active')).status).toBeGreaterThanOrEqual(500);
  });
  it('does not clear Claude sessions, live state or pending asks after one engine read fails', async () => {
    const { app } = await fixture({ failClaude: true });
    expect((await request(app).get('/api/session')).status).toBeGreaterThanOrEqual(500);
    expect((await request(app).get('/api/session/active')).status).toBeGreaterThanOrEqual(500);
    expect((await request(app).get('/api/permission/request')).status).toBeGreaterThanOrEqual(500);
  });
  it('serves native engine IDs while the independent OpenCode backend is unavailable', async () => {
    const { app, codexID } = await fixture({ openCodeReady: false });
    expect((await request(app).get(`/api/session/${codexID}`)).status).toBe(200);
    expect((await request(app).get('/api/engines')).status).toBe(200);
    expect((await request(app).get('/api/session')).status).toBe(503);
  });
});
