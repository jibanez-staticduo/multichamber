import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('the legacy product glyph renders the Multichamber M instead of the upstream cube', () => {
  const sprite = fs.readFileSync(new URL('../packages/ui/src/components/icon/sprite.ts', import.meta.url), 'utf8');
  const glyph = sprite.split('"multichamber": `')[1]?.split('`')[0];
  assert.ok(glyph);
  assert.match(glyph, /M8 10 22 20 32 27 42 20 56 10/);
  assert.doesNotMatch(glyph, /12 2\.5 3\.5 7\.4/);
  assert.match(glyph, /currentColor/);
});
