import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { packageForkWeb } from './package-fork-web.mjs';

test('release archive carries the fork SDK and excludes unlisted files', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multichamber-pack-test-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['web', 'sdk']) {
    const directory = path.join(root, 'packages', name);
    fs.mkdirSync(path.join(directory, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'dist', name === 'web' ? 'index.html' : 'index.js'), 'fork-build');
    fs.writeFileSync(path.join(directory, 'local-secret'), 'excluded');
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({
      name: `@multichamber/${name}`, version: '1.2.3', files: ['dist'],
      dependencies: name === 'web' ? { '@multichamber/sdk': 'workspace:*' } : {},
      scripts: { prepack: 'exit 1' },
    }));
  }
  const archive = packageForkWeb(root);
  const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' });
  assert.match(listing, /package\/node_modules\/@multichamber\/sdk\/dist\/index.js/);
  assert.doesNotMatch(listing, /local-secret/);
  const manifest = JSON.parse(execFileSync('tar', ['-xOzf', archive, 'package/package.json'], { encoding: 'utf8' }));
  assert.equal(manifest.dependencies['@multichamber/sdk'], '1.2.3');
  assert.deepEqual(manifest.bundleDependencies, ['@multichamber/sdk']);
  assert.equal(fs.existsSync(path.join(root, 'artifacts/fork-web/multichamber-web.tgz')), true);
  assert.equal(manifest.scripts.prepack, undefined);
  const installed = path.join(root, 'installed');
  execFileSync('npm', ['install', '--prefix', installed, '--ignore-scripts', '--offline', '--no-audit', '--no-fund', archive], {
    encoding: 'utf8', windowsHide: true,
  });
  assert.equal(fs.readFileSync(path.join(installed, 'node_modules/@multichamber/web/node_modules/@multichamber/sdk/dist/index.js'), 'utf8'), 'fork-build');
});
