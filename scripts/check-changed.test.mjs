import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { checkAntiSlopRatchet, findRatchetViolations } from './check-changed.mjs';

const counts = (entries) => new Map(entries.map(([file, rule, count]) => [`${file}\0${rule}`, count]));

test('old findings may stay or shrink', () => {
  const base = counts([['a.ts', 'anti-slop(no-runtime-typeof)', 3]]);
  assert.deepEqual(findRatchetViolations(base, counts([['a.ts', 'anti-slop(no-runtime-typeof)', 3]])), []);
  assert.deepEqual(findRatchetViolations(base, counts([['a.ts', 'anti-slop(no-runtime-typeof)', 1]])), []);
});

test('code moved into a new shared file is not new', () => {
  const base = counts([['a.js', 'anti-slop(no-runtime-typeof)', 2], ['b.js', 'anti-slop(no-runtime-typeof)', 2]]);
  const current = counts([['shared.js', 'anti-slop(no-runtime-typeof)', 3]]);
  assert.deepEqual(findRatchetViolations(base, current), []);
});

test('a rule that grows across the change is a violation, naming the files it grew in', () => {
  const base = counts([['a.ts', 'anti-slop(no-runtime-typeof)', 3], ['a.ts', 'anti-slop(no-unknown-returns)', 2]]);
  const current = counts([
    ['a.ts', 'anti-slop(no-runtime-typeof)', 1],
    ['a.ts', 'anti-slop(no-unknown-returns)', 2],
    ['new.ts', 'anti-slop(no-unknown-returns)', 1],
  ]);
  assert.deepEqual(findRatchetViolations(base, current), [
    { rule: 'anti-slop(no-unknown-returns)', base: 2, current: 3, files: ['new.ts'] },
  ]);
});

test('the Git baseline retains moved findings before and after staging, while new findings fail', (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'multichamber-ratchet-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '--quiet');
  writeFileSync(path.join(root, 'old.ts'), 'export const kind = (value: string) => typeof value;\n');
  git('add', 'old.ts');
  git('-c', 'user.name=Ratchet test', '-c', 'user.email=ratchet@example.test', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'baseline');
  const base = git('rev-parse', 'HEAD').trim();

  renameSync(path.join(root, 'old.ts'), path.join(root, 'renamed.ts'));
  assert.deepEqual(checkAntiSlopRatchet(base, root), []);
  git('add', '-A');
  assert.deepEqual(checkAntiSlopRatchet(base, root), []);

  writeFileSync(path.join(root, 'added.ts'), 'export const extra = (value: string) => typeof value;\n');
  const growth = checkAntiSlopRatchet(base, root);
  assert.equal(growth.length, 1);
  assert.equal(growth[0].rule, 'anti-slop(no-runtime-typeof)');
  assert.equal(growth[0].base, 1);
  assert.equal(growth[0].current, 2);
  assert.ok(growth[0].files.includes('added.ts'));

  unlinkSync(path.join(root, 'renamed.ts'));
  assert.deepEqual(checkAntiSlopRatchet(base, root), []);
});
