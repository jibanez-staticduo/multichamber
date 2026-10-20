import { afterEach, expect, test } from 'bun:test';
import { probeNativeHarnessAvailability } from './nativeHarnessAvailability';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('native readiness requires a live, valid available Claude or Codex response', async () => {
  globalThis.fetch = async () => Response.json({ engines: [{ id: 'opencode', available: true }, { id: 'claude', available: false }] });
  expect(await probeNativeHarnessAvailability()).toBe(false);
  globalThis.fetch = async () => Response.json({ engines: [{ id: 'claude', available: true }] });
  expect(await probeNativeHarnessAvailability()).toBe(true);
  globalThis.fetch = async () => Response.json({ engines: [{ id: 'codex', available: true }] });
  expect(await probeNativeHarnessAvailability()).toBe(true);
});

test('an unavailable or malformed catalog is a failure, never native readiness', async () => {
  globalThis.fetch = async () => new Response(null, { status: 503 });
  await expect(probeNativeHarnessAvailability()).rejects.toThrow('503');
  globalThis.fetch = async () => Response.json({ engines: [{ id: 'codex' }] });
  await expect(probeNativeHarnessAvailability()).rejects.toThrow();
});
