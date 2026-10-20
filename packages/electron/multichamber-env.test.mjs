import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

test('every early Electron entry imports only the lightweight environment bridge first', () => {
  const declaration = "import '@multichamber/web/server/lib/multichamber-env.js';";
  for (const file of ['entry.mjs', 'early-startup.mjs']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    const firstImport = source.match(/^import .+$/m)?.[0];
    assert.equal(firstImport, declaration);
  }
  const capture = `data:text/javascript,${encodeURIComponent('export const value = process.env.OPENCHAMBER_ELECTRON_DEV;')}`;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `import '@multichamber/web/server/lib/multichamber-env.js'; import {value} from ${JSON.stringify(capture)}; console.log(value);`], {
    cwd: new URL('.', import.meta.url), env: { ...process.env, MULTICHAMBER_ELECTRON_DEV: '1', OPENCHAMBER_ELECTRON_DEV: '0' }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(output.trim(), '1');
});
