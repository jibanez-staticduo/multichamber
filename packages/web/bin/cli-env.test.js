import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { expect, it } from 'vitest';

it('normalizes canonical CLI configuration before argument and network helpers run', () => {
  const source = fs.readFileSync(new URL('./cli.js', import.meta.url), 'utf8');
  expect(source.match(/^import .+$/m)?.[0]).toBe("import '../server/lib/multichamber-env.js';");
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `import {resolveServeHost} from ${JSON.stringify(new URL('./cli.js', import.meta.url).href)}; console.log(resolveServeHost());`], {
    env: { ...process.env, MULTICHAMBER_HOST: '127.0.0.2', OPENCHAMBER_HOST: '127.0.0.3' }, encoding: 'utf8', windowsHide: true,
  });
  expect(output.trim()).toBe('127.0.0.2');
});
