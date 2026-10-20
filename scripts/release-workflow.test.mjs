import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
const workflow = parse(fs.readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));

test('dry runs cannot mutate a release or publish packages', () => {
  for (const job of Object.values(workflow.jobs)) {
    if (job.uses?.includes('mobile-release')) { assert.match(job.if, /dry_run != 'true'/); continue; }
    for (const step of job.steps ?? []) {
      if (step.uses?.startsWith('softprops/action-gh-release') || step.run?.includes('bun publish')) {
        assert.match(step.if ?? job.if ?? '', /dry_run != 'true'/, step.name);
      }
    }
  }
});

test('stable tags build web, Windows and Linux while Apple, mobile, npm and publication are opt-in', () => {
  const inputs = workflow.on.workflow_dispatch.inputs;
  for (const name of ['build_web', 'build_windows', 'build_linux']) assert.equal(inputs[name].default, true);
  for (const name of ['build_macos', 'build_mobile', 'publish_npm', 'publish_release']) assert.equal(inputs[name].default, false);
  assert.match(workflow.jobs['build-desktop-electron-macos'].if, /inputs.build_macos/);
  const steps = workflow.jobs['finalize-release'].steps;
  assert.match(steps.find((step) => step.name === 'Publish release').if, /inputs.publish_release/);
  const inventory = steps.find((step) => step.name === 'Verify selected release asset inventory');
  for (const name of ['multichamber-web.tgz', 'latest.yml', 'latest-arm64.yml', 'latest-linux.yml', 'latest-linux-arm64.yml']) assert.ok(inventory.run.includes(name));
  assert.ok(!JSON.stringify(workflow).includes('DISCORD_WEBHOOK_URL'));
});
