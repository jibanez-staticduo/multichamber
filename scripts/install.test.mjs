import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./install.sh', import.meta.url));
const archive = 'https://github.com/jibanez-staticduo/multichamber/releases/latest/download/multichamber-web.tgz';

function fixture(context, { installed = false, owned = true, manager = 'npm', fail = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multichamber-install-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const packageRoot = path.join(root, 'global/node_modules');
  const log = path.join(root, 'calls');
  fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  fs.symlinkSync('/bin/cat', path.join(bin, 'cat'));
  for (const pm of ['npm', 'pnpm', 'yarn', 'bun']) {
    fs.writeFileSync(path.join(bin, pm), `#!/bin/bash
if [[ "$1" == --version ]]; then echo "10.4.0"; exit 0; fi
if [[ "$1" == root ]]; then
  [[ "$STUB_MANAGER" == "${pm}" && "$STUB_OWNED" == 1 ]] && echo "$STUB_ROOT"
  exit 0
fi
if [[ "$1 $2" == 'global dir' ]]; then exit 0; fi
printf '%s\\n' '${pm}' "$@" >> "$STUB_LOG"
exit "$STUB_EXIT"
`, { mode: 0o755 });
  }
  if (installed) {
    const directory = path.join(packageRoot, '@openchamber/web');
    fs.mkdirSync(path.join(directory, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: '@openchamber/web' }));
    fs.writeFileSync(path.join(directory, 'bin/cli.js'), '#!/bin/bash\necho OLD-UPDATER >> "$STUB_LOG"\nexit 1\n', { mode: 0o755 });
    fs.symlinkSync(path.join(directory, 'bin/cli.js'), path.join(bin, 'openchamber'));
  }
  const run = spawnSync('/bin/bash', [script], {
    cwd: root, encoding: 'utf8',
    env: { ...process.env, PATH: bin, npm_config_user_agent: `${manager}/1`, STUB_MANAGER: manager,
      STUB_ROOT: packageRoot, STUB_LOG: log, STUB_OWNED: owned ? '1' : '0', STUB_EXIT: fail ? '1' : '0',
      BUN_INSTALL: path.join(root, 'unused-bun') },
  });
  return { ...run, calls: fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '' };
}

test('first installation uses the fork archive for every package manager', (context) => {
  for (const manager of ['npm', 'pnpm', 'yarn', 'bun']) {
    const result = fixture(context, { manager });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.calls, new RegExp(manager));
    assert.ok(result.calls.includes(archive));
    assert.doesNotMatch(result.calls, /@openchamber\/web/);
  }
});

test('existing upstream install keeps its actual manager without invoking its updater', (context) => {
  const result = fixture(context, { installed: true, manager: 'pnpm' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls, `pnpm\nadd\n-g\n--allow-build=msgpackr-extract\n--allow-build=node-pty\n${archive}\n`);
});

test('unknown ownership refuses to install or invoke an upstream updater', (context) => {
  const result = fixture(context, { installed: true, owned: false });
  assert.equal(result.status, 1);
  assert.equal(result.calls, '');
  assert.match(result.stdout, /No changes made/);
});

test('package manager failure remains an install failure', (context) => {
  const result = fixture(context, { fail: true });
  assert.equal(result.status, 1);
  assert.ok(result.calls.includes(archive));
});
