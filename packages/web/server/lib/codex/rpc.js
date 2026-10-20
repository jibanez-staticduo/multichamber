import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Duplex } from 'node:stream';
import WebSocket from 'ws';
import { z } from 'zod';

const disconnected = () => Object.assign(new Error('Codex app-server disconnected'), { code: 'CODEX_DISCONNECTED' });
const messageSchema = z.object({ id: z.union([z.string(), z.number(), z.null()]).optional(), method: z.string().optional(), params: z.json().optional(), result: z.json().optional(), error: z.object({ code: z.number(), message: z.string(), data: z.json().optional() }).optional() });

/** One connection to the existing authority. Managed stdio is explicit opt-in. */
export const createCodexRpc = ({ env = process.env, spawnProcess = spawn, timeoutMs = 30_000, onNotification = () => {}, onRequest = () => {}, onDisconnect = () => {} } = {}) => {
  const pending = new Map();
  let sequence = 0;
  let socket;
  let child;
  let opening;
  let ready = false;
  let connectedBefore = false;
  let disposed = false;
  const mode = env.OPENCHAMBER_CODEX_TRANSPORT || (process.platform === 'win32' ? 'proxy' : 'unix');
  const socketPath = env.OPENCHAMBER_CODEX_SOCKET || path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'app-server-control', 'app-server-control.sock');
  const send = (message) => {
    const serialized = JSON.stringify(message);
    if (mode === 'stdio') {
      if (!child?.stdin?.writable) throw disconnected();
      child.stdin.write(`${serialized}\n`);
    } else {
      if (socket?.readyState !== WebSocket.OPEN) throw disconnected();
      socket.send(serialized);
    }
  };
  const fail = () => {
    const hadConnection = ready;
    ready = false;
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(disconnected()); }
    pending.clear();
    if (hadConnection) onDisconnect();
  };
  const receive = (raw) => {
    let message;
    try { message = messageSchema.parse(JSON.parse(String(raw))); } catch { socket?.terminate(); fail(); return; }
    if (message.method) {
      try {
        if (message.id !== undefined) onRequest(message);
        else onNotification(message.method, message.params || {});
      } catch { socket?.terminate(); child?.kill(); fail(); }
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(Object.assign(new Error(message.error.message || 'Codex RPC failed'), { code: message.error.code, data: message.error.data }));
    else request.resolve(message.result);
  };
  const rawRequest = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Codex ${method} timed out`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try { send({ id, method, params }); } catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
  const connect = async () => {
    if (disposed) throw disconnected();
    if (!['unix', 'proxy', 'stdio'].includes(mode)) throw new Error('Invalid OPENCHAMBER_CODEX_TRANSPORT');
    if (mode !== 'stdio') {
      try { await access(socketPath); } catch (error) { if (error.code === 'ENOENT' && !connectedBefore) return false; throw error; }
    }
    if (mode === 'stdio') {
      child = spawnProcess(env.OPENCHAMBER_CODEX_BINARY || 'codex', ['app-server', '--listen', 'stdio://'], { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        buffer += chunk;
        if (buffer.length > 16 * 1024 * 1024) { child.kill(); fail(); return; }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (line.trim()) receive(line); }
      });
      child.on('error', fail);
      child.on('exit', fail);
    } else {
      let options = { perMessageDeflate: false, handshakeTimeout: timeoutMs, maxPayload: 16 * 1024 * 1024 };
      let address = `ws+unix://${socketPath}:/`;
      if (mode === 'proxy') {
        child = spawnProcess(env.OPENCHAMBER_CODEX_BINARY || 'codex', ['app-server', 'proxy', '--sock', socketPath], { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
        // The CLI proxy carries raw WebSocket bytes, not JSONL.
        const stream = Duplex.from({ readable: child.stdout, writable: child.stdin });
        stream.setTimeout = () => stream;
        stream.setNoDelay = () => stream;
        stream.setKeepAlive = () => stream;
        options = { ...options, createConnection: () => stream };
        address = 'ws://localhost/';
        child.on('error', () => { stream.destroy(); fail(); });
        child.on('exit', () => { stream.destroy(); fail(); });
      }
      socket = new WebSocket(address, options);
      socket.on('message', receive);
      socket.on('close', fail);
      socket.on('error', fail);
      await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); socket.once('close', () => reject(disconnected())); });
    }
    await rawRequest('initialize', { clientInfo: { name: 'multichamber', title: 'Multichamber', version: '2.1.1' }, capabilities: { experimentalApi: true } });
    send({ method: 'initialized' });
    ready = true;
    connectedBefore = true;
    return true;
  };
  const ensureAvailable = async () => {
    if (ready) return true;
    if (!opening) opening = connect().catch((error) => { socket?.terminate(); child?.kill(); throw error; }).finally(() => { opening = null; });
    return opening;
  };
  return {
    ensureAvailable,
    request: async (method, params = {}) => { if (!await ensureAvailable()) throw Object.assign(new Error('Codex control socket is unavailable'), { code: 'CODEX_UNAVAILABLE' }); return rawRequest(method, params); },
    respond: (id, result) => send({ id, result }),
    reject: (id, message = 'Unsupported client request') => send({ id, error: { code: -32601, message } }),
    dispose: async () => {
      disposed = true;
      socket?.terminate();
      if (child && child.exitCode === null && child.signalCode === null) {
        const stopped = new Promise((resolve) => { child.once('exit', resolve); child.once('error', resolve); });
        child.kill();
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
        await stopped;
        clearTimeout(timer);
      }
      fail();
    },
  };
};
