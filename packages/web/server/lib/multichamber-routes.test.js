import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createUiAuth } from './ui-auth/ui-auth.js';
import { canonicalMultichamberApi } from './multichamber-routes.js';

const controllers = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });
const fixture = () => {
  const app = express();
  app.use(canonicalMultichamberApi);
  const auth = createUiAuth({ password: 'test-password', clientAuthController: { authenticateBearerToken: async (token) => token === 'test-client' ? { ok: true, clientId: 'fixture' } : null } });
  controllers.push(auth);
  app.use('/api', (req, res, next) => auth.requireAuth(req, res, next));
  app.use(express.json());
  app.all('/api/openchamber/echo', (req, res) => res.json({ url: req.url, originalUrl: req.originalUrl, query: req.query, body: req.body, authorization: req.get('authorization') }));
  app.get('/api/multichamber-other', (_req, res) => res.json({ untouched: true }));
  return app;
};

describe('canonical Multichamber API alias', () => {
  it.each(['/api/multichamber/echo', '/api/openchamber/echo'])('keeps the same real UI auth gate for %s', async (url) => {
    const app = fixture();
    await request(app).get(url).expect(401);
    const response = await request(app).post(`${url}?directory=%2Frepo&value=a%2Bb`).set('authorization', 'Bearer test-client').send({ text: 'same payload' }).expect(200);
    expect(response.body).toMatchObject({ url: '/api/openchamber/echo?directory=%2Frepo&value=a%2Bb', originalUrl: '/api/openchamber/echo?directory=%2Frepo&value=a%2Bb', query: { directory: '/repo', value: 'a+b' }, body: { text: 'same payload' }, authorization: 'Bearer test-client' });
  });
  it('rewrites only the exact namespace boundary', async () => {
    const app = fixture();
    expect((await request(app).get('/api/multichamber-other').set('authorization', 'Bearer test-client').expect(200)).body).toEqual({ untouched: true });
  });
});
