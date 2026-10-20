import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Nix exposes the fork package, app, service and native identity', () => {
  const flake = read('flake.nix');
  assert.match(flake, /multichamber = self\.packages/);
  assert.match(flake, /nixosModules\.multichamber/);
  assert.match(flake, /electron_44/);
  const gui = read('nix/gui.nix');
  assert.match(gui, /@multichamber\/web/);
  assert.match(gui, /startupWMClass = "multichamber"/);
  assert.match(gui, /x-scheme-handler\/multichamber/);
  const module = read('nix/module.nix');
  assert.match(module, /options\.services\.multichamber/);
  assert.match(module, /systemd\.services\.multichamber/);
  assert.match(module, /\/bin\/multichamber serve/);
  for (const file of ['nix/package.nix', 'nix/gui.nix']) {
    assert.match(read(file), /https:\/\/github\.com\/jibanez-staticduo\/multichamber/);
    assert.doesNotMatch(read(file), /@openchamber\//);
  }
  assert.match(flake, /OPENCODE_DISABLE_AUTOUPDATE 1/);
});
