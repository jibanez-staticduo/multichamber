import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCodexSurface } from './routes.js';
import { translateWireEvent } from '../../../../ui/src/lib/opencode/events.ts';
import { projectMessages } from '../../../../ui/src/lib/opencode/projection.ts';
import { sortMessagesChronologically } from '../../../../ui/src/sync/message-ordering.ts';

const hasCodex = spawnSync('codex', ['--version'], { windowsHide: true }).status === 0;

it.runIf(hasCodex)('HTTP surface drives a real app-server turn, history and lifecycle with an isolated local provider', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'multichamber-codex-real-'));
  const requests = [];
  const provider = http.createServer(async (req, res) => {
    // Consume request data without logging prompts or environment credentials.
    for await (const chunk of req) void chunk;
    requests.push(req.url);
    const item = { id: 'answer_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Codex fixture complete', annotations: [] }] };
    const response = { id: 'resp_fixture', object: 'response', created_at: 1, status: 'completed', model: 'fixture-model', output: [item], usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 } };
    const events = [
      ['response.created', { response: { ...response, status: 'in_progress', output: [] } }],
      ['response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } }],
      ['response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }],
      ['response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: 'Codex fixture complete' }],
      ['response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: 'Codex fixture complete' }],
      ['response.output_item.done', { output_index: 0, item }],
      ['response.completed', { response }],
    ];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    res.end();
  });
  const port = await new Promise((resolve) => {
    provider.listen(0, '127.0.0.1', () => {
      const address = provider.address();
      resolve(address.port);
    });
  });
  await writeFile(path.join(home, 'config.toml'), `model = "fixture-model"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nsupports_websockets = false\n`);
  const events = [];
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  const surface = createCodexSurface({
    env: { ...process.env, CODEX_HOME: home, OPENCHAMBER_CODEX_TRANSPORT: 'stdio' },
    timeoutMs: 10_000,
    isEnterpriseMode: () => false,
    publishEvent: ({ payload }) => {
      events.push(payload);
      if (payload.type === 'session.idle' || payload.type === 'session.execution.failed') finish(payload);
    },
  });
  const app = express();
  surface.register(app);
  app.get('/api/session', async (req, res) => res.json({ data: await surface.listCodexSessions() }));
  let deadline;
  try {
    const createdResponse = await request(app).post('/api/session').send({ location: { directory: home }, metadata: { backend: 'codex', codex: { model: 'fixture-model' } } }).expect(200);
    const created = createdResponse.body.data;
    const sessionPath = `/api/session/${created.id}`;
    expect(created.metadata.codex.mode).toBe('full-access');
    expect((await request(app).get(sessionPath).expect(200)).body.data.id).toBe(created.id);
    expect((await request(app).get(`${sessionPath}/message`).expect(200)).body.data).toEqual([]);
    expect((await request(app).get('/api/session').expect(200)).body.data.some((thread) => thread.id === created.id)).toBe(true);
    const prompt = await request(app).post(`${sessionPath}/prompt`).send({ text: 'Return fixture text', id: 'msg_fixture' }).expect(200);
    expect(prompt.body.data).toMatchObject({ id: 'msg_fixture', sessionID: created.id, type: 'user', payload: { text: 'Return fixture text' } });
    const outcome = await Promise.race([completed, new Promise((resolve, reject) => { deadline = setTimeout(() => reject(new Error('Codex fixture turn timed out')), 15_000); })]);
    clearTimeout(deadline);
    expect(outcome.type).toBe('session.idle');
    expect(requests).toContain('/v1/responses');
    expect(events.some((event) => event.type === 'session.text.delta' && event.data.delta === 'Codex fixture complete')).toBe(true);
    const translated = events.flatMap(translateWireEvent);
    expect(translated.some((event) => event.type === 'message.updated' && event.properties.info.id === prompt.body.data.id && event.properties.info.role === 'user')).toBe(true);
    const messages = (await request(app).get(`${sessionPath}/message`).query({ order: 'asc' }).expect(200)).body.data;
    expect(messages.find((message) => message.type === 'user').id).toBe('msg_fixture');
    expect(messages.some((message) => message.content?.some((content) => content.text === 'Codex fixture complete'))).toBe(true);
    const assistant = messages.find((message) => message.type === 'assistant');
    expect(assistant.tokens.input + assistant.tokens.output + assistant.tokens.cache.read).toBe(7);
    expect(assistant.metadata.codex.usageAvailable).toBe(true);
    expect(events.filter((event) => event.type === 'session.step.ended').some((event) => event.data.tokens.input + event.data.tokens.output + event.data.tokens.cache.read === 7)).toBe(true);
    const projected = projectMessages(messages, created.id).map((record) => record.message);
    expect(sortMessagesChronologically(projected).map((message) => message.role)).toEqual(['user', 'assistant']);
    const liveInfos = translated.filter((event) => event.type === 'message.updated').map((event) => event.properties.info);
    const liveUser = liveInfos.find((message) => message.role === 'user');
    const liveAssistant = liveInfos.find((message) => message.role === 'assistant');
    expect(sortMessagesChronologically([liveAssistant, liveUser]).map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(liveUser.time.created).toBe(messages.find((message) => message.type === 'user').time.created);
    expect(liveAssistant.time.created).toBe(assistant.time.created);
    expect(events.find((event) => event.type === 'session.text.ended').data.assistantMessageID).toBe(assistant.id);
    expect((await request(app).get(`${sessionPath}/message/${assistant.id}`).expect(200)).body.data).toEqual(assistant);
    await request(app).patch(sessionPath).send({ title: 'Fixture renamed' }).expect(204);
    expect((await request(app).get(sessionPath).expect(200)).body.data.title).toBe('Fixture renamed');
    const fork = (await request(app).post(`${sessionPath}/fork`).send({}).expect(200)).body.data;
    expect(fork.id).not.toBe(created.id);
    await request(app).patch(sessionPath).send({ time: { archived: Date.now() } }).expect(204);
    expect((await request(app).get('/api/session').expect(200)).body.data.find((thread) => thread.id === created.id).time.archived).toBeGreaterThan(0);
    await request(app).patch(sessionPath).send({ time: { archived: null } }).expect(204);
    expect((await request(app).get('/api/session').expect(200)).body.data.find((thread) => thread.id === created.id).time.archived).toBeUndefined();
    const invalidMode = await request(app).post(`${sessionPath}/codex/mode`).send({ mode: 'invalid-mode' }).expect(400);
    expect(invalidMode.body).toMatchObject({ _tag: 'InvalidRequestError', message: 'Unknown Codex mode' });
    const unsupported = await request(app).post(`${sessionPath}/command`).send({ name: 'unknown' }).expect(400);
    expect(unsupported.body).toMatchObject({ _tag: 'UnsupportedOperationError', engine: 'codex', operation: 'command' });
    await request(app).delete(`/api/session/${fork.id}`).expect(204);
    await request(app).delete(sessionPath).expect(204);
    expect((await request(app).get('/api/session').expect(200)).body.data.some((thread) => thread.id === fork.id || thread.id === created.id)).toBe(false);
  } finally {
    clearTimeout(deadline);
    await surface.dispose();
    await new Promise((resolve) => provider.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
}, 30_000);
