import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { RELEASE_PACKAGE_FILES } from './bump-version.mjs';

const rootFile = (relative) => new URL(`../${relative}`, import.meta.url);

test('build, release and workspace tooling no longer require the removed extension', () => {
  assert.equal(existsSync(rootFile('packages/vscode')), false);
  assert.equal(existsSync(rootFile('.github/workflows/vscode-extension.yml')), false);
  assert.equal(existsSync(rootFile('scripts/dev-vscode.mjs')), false);
  const manifest = JSON.parse(readFileSync(rootFile('package.json'), 'utf8'));
  assert.ok(Object.keys(manifest.scripts).every((name) => !name.startsWith('vscode:')));
  for (const command of Object.values(manifest.scripts)) assert.doesNotMatch(command, /packages\/vscode/);
  assert.ok(RELEASE_PACKAGE_FILES.every((relative) => existsSync(rootFile(relative))));
  for (const file of ['Dockerfile', 'knip.json', 'bun.lock', '.github/workflows/oc-review.yml', 'packages/ui/src/lib/settings/registry-snapshot.ts']) {
    assert.doesNotMatch(readFileSync(rootFile(file), 'utf8'), /packages\/vscode/);
  }
});
