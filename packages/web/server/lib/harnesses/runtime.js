import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { isEnterpriseMode } from '../enterprise-mode.js';

const versionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/);
const packages = { opencode: '@opencode/cli', claude: '@anthropic-ai/claude-code', codex: '@openai/codex' };
const execute = (binary, args, { env, timeout = 10_000 } = {}) => new Promise((resolve, reject) => {
  const child = execFile(binary, args, { env, timeout, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(new Error('Harness command failed. Run its native command in a terminal for details.')) : resolve(stdout));
  child.stdin?.end();
});
const versionOf = (output) => versionSchema.parse(output.trim().match(/\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?/)?.[0]);
const newer = (latest, installed) => {
  const [latestCore, latestPrerelease] = latest.split('-');
  const [installedCore, installedPrerelease] = installed.split('-');
  const left = latestCore.split('.').map(Number);
  const right = installedCore.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) if (left[index] !== right[index]) return left[index] > right[index];
  if (!latestPrerelease && installedPrerelease) return true;
  if (latestPrerelease && !installedPrerelease) return false;
  return (latestPrerelease || '').localeCompare(installedPrerelease || '', undefined, { numeric: true }) > 0;
};

/** Installation ownership is established from the selected executable, never a client command. */
export const createHarnessManager = ({ claudeSurface, codexSurface, openCode, readSettings, env = process.env, executeCommand = execute, fetchImpl = fetch, fileSystem = fs } = {}) => {
  const checks = new Map();
  const updating = new Set();
  const findExecutable = async (id) => {
    if (id === 'claude') return claudeSurface.runtime.resolveExecutable();
    if (env.OPENCHAMBER_CODEX_BINARY) return env.OPENCHAMBER_CODEX_BINARY;
    const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex'] : ['codex'];
    for (const directory of (env.PATH || '').split(path.delimiter)) for (const name of names) {
      const candidate = path.join(directory, name);
      try { await fileSystem.access(candidate); return candidate; } catch { /* Continue through PATH. */ }
    }
    return null;
  };
  const installOf = async (id) => {
    const binary = await findExecutable(id);
    if (!binary) return { binary: null, owner: 'missing', updateBinary: null, args: [], action: `Install ${id} using its official installer.` };
    const resolved = await fileSystem.realpath(binary);
    const home = os.homedir();
    if (id === 'claude' && resolved.startsWith(path.join(home, '.local/share/claude/versions') + path.sep)) {
      // The installer owns the launcher, which chooses the next installed version.
      const launcher = path.join(home, '.local/bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
      if (await fileSystem.realpath(launcher).catch(() => null) === resolved) return { binary, owner: 'native', updateBinary: launcher, args: ['update'], action: 'claude update' };
    }
    let parent = path.dirname(resolved);
    for (let depth = 0; depth < 6; depth += 1) {
      try {
        const manifest = z.object({ name: z.string() }).parse(JSON.parse(await fileSystem.readFile(path.join(parent, 'package.json'), 'utf8')));
        if (manifest.name === packages[id]) return { binary, owner: 'npm', updateBinary: null, args: [], action: `npm install -g ${packages[id]}@latest` };
      } catch { /* Native binaries do not have package manifests. */ }
      const next = path.dirname(parent);
      if (next === parent) break;
      parent = next;
    }
    return { binary, owner: 'external', updateBinary: null, args: [], action: `Update ${id} with the installer that owns this executable.` };
  };
  const defaultsOf = async (id) => {
    if (id === 'opencode') { const settings = await readSettings(); return { model: settings.defaultModel || null, effort: settings.defaultVariant || null, mode: settings.defaultAgent || null }; }
    const catalog = await (id === 'codex' ? codexSurface.getCatalog() : claudeSurface.getCatalog());
    return { model: catalog.defaultModelId || null, effort: catalog.defaultEffort || null, mode: catalog.defaultMode || null };
  };
  const status = async (id) => {
    const check = checks.get(id);
    let installed = false;
    let running = false;
    let version = null;
    let checkError = check?.error || null;
    let defaults = { model: null, effort: null, mode: null };
    let reason = null;
    let action = null;
    let supported = false;
    try {
      if (id === 'opencode') {
        const current = await openCode.describe();
        installed = current.version !== null;
        version = current.version;
        running = current.running;
        const capability = openCode.capability();
        supported = capability.supported;
        reason = capability.reason;
        action = supported ? 'opencode upgrade' : 'Update the OpenCode installation on its owning host.';
      } else {
        const installation = await installOf(id);
        installed = Boolean(installation.binary);
        action = installation.action;
        if (installed) version = versionOf(await executeCommand(installation.binary, ['--version'], { env }));
        running = id === 'codex' ? await codexSurface.runtime.ensureAvailable() : Object.keys(await claudeSurface.listClaudeActive()).length > 0;
        supported = installation.owner === 'native' && id === 'claude';
        reason = supported ? null : installation.owner === 'missing' ? 'not-installed' : id === 'codex' && env.OPENCHAMBER_CODEX_TRANSPORT !== 'stdio' ? 'shared-authority' : 'installer-owned';
      }
      defaults = await defaultsOf(id);
    } catch (error) { checkError = error.message; }
    if (isEnterpriseMode() && id !== 'opencode') { supported = false; reason = 'enterprise_mode'; }
    const latestVersion = check?.version || null;
    const update = { status: !supported ? 'manual' : !latestVersion || !version ? 'unknown' : newer(latestVersion, version) ? 'available' : 'current', reason, action };
    return { id, installed, running, version, latestVersion, checkError, update, defaults };
  };
  const check = async (id) => {
    try {
      const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(packages[id])}/latest`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`Official package version check failed: HTTP ${response.status}`);
      const parsed = z.object({ version: versionSchema }).parse(await response.json());
      checks.set(id, { version: parsed.version, error: null });
    } catch (error) { checks.set(id, { version: checks.get(id)?.version || null, error: error.message }); }
    return status(id);
  };
  const update = async (id) => {
    if (updating.has(id)) throw Object.assign(new Error('Harness update already running'), { status: 409 });
    updating.add(id);
    try {
    const current = await status(id);
    if (current.checkError) throw Object.assign(new Error('Harness state is unavailable; update was not started'), { status: 409 });
    if (current.update.status === 'manual' || current.update.status === 'unsupported') return { status: 'manual', message: current.update.reason, harness: current };
    if (isEnterpriseMode() && id !== 'opencode') return { status: 'unsupported', message: 'enterprise_mode', harness: current };
    const active = id === 'opencode' ? await openCode.isBusy() : await claudeSurface.listClaudeActive();
    if (active === true || (active && Object.keys(active).length)) throw Object.assign(new Error('Wait for active sessions to finish before updating this harness'), { status: 409 });
      if (id === 'opencode') await openCode.update();
      else {
        const installation = await installOf(id);
        if (installation.owner !== 'native' || !installation.updateBinary) return { status: 'manual', message: 'Installation ownership changed', harness: await status(id) };
        await executeCommand(installation.updateBinary, installation.args, { env, timeout: 120_000 });
      }
      const result = await check(id);
      if (result.checkError || !result.installed || !result.version || !result.latestVersion || newer(result.latestVersion, result.version)) throw new Error('The installed harness version does not match the offered update');
      return { status: 'updated', message: 'Update installed. Existing shared services were not restarted.', harness: result };
    } finally { updating.delete(id); }
  };
  return { status, check, update };
};
