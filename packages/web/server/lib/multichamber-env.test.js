import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { normalizeMultichamberEnv } from './multichamber-env.js';

describe('Multichamber environment compatibility', () => {
  it('prefers canonical variables while keeping legacy-only configuration', () => {
    const env = { MULTICHAMBER_DATA_DIR: '/new', OPENCHAMBER_DATA_DIR: '/old', OPENCHAMBER_PORT: '3080', MULTICHAMBER_RELAY_HOST: 'off' };
    normalizeMultichamberEnv(env);
    expect(env).toEqual({ MULTICHAMBER_DATA_DIR: '/new', OPENCHAMBER_DATA_DIR: '/new', OPENCHAMBER_PORT: '3080', MULTICHAMBER_RELAY_HOST: 'off', OPENCHAMBER_RELAY_HOST: 'off' });
  });
  it('preserves an explicit empty canonical value and never rewrites harness variables', () => {
    const env = { MULTICHAMBER_UI_PASSWORD: '', OPENCHAMBER_UI_PASSWORD: 'legacy', CODEX_HOME: '/native', OPENCODE_HOST: 'http://localhost', ANTHROPIC_BASE_URL: 'http://local-provider' };
    normalizeMultichamberEnv(env);
    expect(env.OPENCHAMBER_UI_PASSWORD).toBe('');
    expect(env.CODEX_HOME).toBe('/native');
    expect(env.OPENCODE_HOST).toBe('http://localhost');
    expect(env.ANTHROPIC_BASE_URL).toBe('http://local-provider');
    expect(normalizeMultichamberEnv(env)).toEqual(env);
  });
  it('applies its side effect before a later module captures environment state', () => {
    const capture = `data:text/javascript,${encodeURIComponent('export const captured = process.env.OPENCHAMBER_TEST_BOOT;')}`;
    const result = execFileSync(process.execPath, ['--input-type=module', '-e', `import ${JSON.stringify(new URL('./multichamber-env.js', import.meta.url).href)}; import {captured} from ${JSON.stringify(capture)}; console.log(captured);`], {
      env: { ...process.env, MULTICHAMBER_TEST_BOOT: 'canonical', OPENCHAMBER_TEST_BOOT: 'legacy' }, encoding: 'utf8', windowsHide: true,
    });
    expect(result.trim()).toBe('canonical');
  });
});
