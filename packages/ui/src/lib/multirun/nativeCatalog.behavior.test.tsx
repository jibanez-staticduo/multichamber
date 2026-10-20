import React, { act } from 'react';
import { afterEach, expect, test } from 'bun:test';
import { createRoot, installDom } from '@/test-utils/happyDomHarness';
import { switchRuntimeEndpoint } from '@/lib/runtime-switch';
import { useMultiRunNativeCatalog } from './nativeCatalog';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: '' }); });

test('native lane catalogs belong to the current host and preserve engine identity', async () => {
  const dom = installDom(); const root = createRoot(dom.container);
  globalThis.fetch = async (input) => {
    const claude = String(input).includes('/claude/');
    return Response.json(claude ? { models: [{ id: 'same', label: 'Claude local' }], efforts: [{ id: 'high', label: 'High' }] } : {
      models: [{ id: 'same', label: 'Codex local', supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: '' }] }], defaultModelId: 'same', efforts: [{ id: 'medium', label: 'Medium' }], defaultEffort: 'medium', modes: [], defaultMode: 'full-access',
    });
  };
  function Probe() { const models = useMultiRunNativeCatalog(); return <output>{models.map((model) => `${model.harness}:${model.id}:${model.efforts.join(',')}`).sort().join('|')}</output>; }
  try {
    await act(async () => { root.render(<Probe />); });
    expect(dom.container.textContent).toBe('claude:same:high|codex:same:medium');
    globalThis.fetch = async () => new Response('', { status: 503 });
    await act(async () => { switchRuntimeEndpoint({ apiBaseUrl: 'http://next-host.example', runtimeKey: 'next-host' }); root.render(<Probe />); });
    expect(dom.container.textContent).toBe('');
  } finally { await act(async () => root.unmount()); dom.restore(); }
});
