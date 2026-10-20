import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import { describe, expect, it } from 'vitest';
import { createCodexRpc } from './rpc.js';
import { spawnSync } from 'node:child_process';

const hasCodex = spawnSync('codex', ['--version'], { windowsHide: true }).status === 0;

const serve = async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'multichamber-codex-'));
  const socketPath = path.join(directory, 'control.sock');
  const httpServer = http.createServer();
  const server = new WebSocketServer({ server: httpServer, perMessageDeflate: false });
  const messages = [];
  server.on('connection', (client) => client.on('message', (raw) => {
    const message = JSON.parse(String(raw));
    messages.push(message);
    if (message.id && message.method !== 'hang') client.send(JSON.stringify({ id: message.id, result: message.method === 'initialize' ? { userAgent: 'test' } : { echo: message.params } }));
  }));
  await new Promise((resolve) => httpServer.listen(socketPath, resolve));
  return { socketPath, messages, server, close: async () => { for (const client of server.clients) client.terminate(); await new Promise((resolve) => server.close(resolve)); await new Promise((resolve) => httpServer.close(resolve)); await rm(directory, { recursive: true, force: true }); } };
};

describe('Codex RPC transport', () => {
  it('uses WebSocket to the existing Unix authority and rejects in-flight calls on disconnect', async () => {
    const f = await serve();
    const client = createCodexRpc({ env: { OPENCHAMBER_CODEX_SOCKET: f.socketPath }, timeoutMs: 1000 });
    try {
      expect(await client.ensureAvailable()).toBe(true);
      expect(await client.request('echo', { text: 'hello' })).toEqual({ echo: { text: 'hello' } });
      expect(f.messages.slice(0, 2).map((message) => message.method)).toEqual(['initialize', 'initialized']);
      const hanging = client.request('hang');
      await new Promise((resolve) => setTimeout(resolve, 20));
      for (const socket of f.server.clients) socket.terminate();
      await expect(hanging).rejects.toThrow('disconnected');
    } finally { await client.dispose(); await f.close(); }
  });
  it.runIf(hasCodex)('real installed codex proxy preserves raw WebSocket framing to an isolated socket', async () => {
    const f = await serve();
    const client = createCodexRpc({ env: { ...process.env, OPENCHAMBER_CODEX_SOCKET: f.socketPath, OPENCHAMBER_CODEX_TRANSPORT: 'proxy' }, timeoutMs: 3000 });
    try {
      expect(await client.ensureAvailable()).toBe(true);
      expect(await client.request('echo', { transport: 'proxy' })).toEqual({ echo: { transport: 'proxy' } });
    } finally { await client.dispose(); await f.close(); }
  });
  it('reports unavailable only before initial connection to a missing authority', async () => {
    const client = createCodexRpc({ env: { OPENCHAMBER_CODEX_SOCKET: '/tmp/nonexistent-multichamber-codex.sock' } });
    try { expect(await client.ensureAvailable()).toBe(false); await expect(client.request('thread/list')).rejects.toThrow('unavailable'); }
    finally { await client.dispose(); }
  });
});
