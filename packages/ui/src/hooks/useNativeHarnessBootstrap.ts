import React from 'react';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { resolveSessionEngine } from '@/lib/sessionEngine';
import { z } from 'zod';
import { readNativeHarnessSessions, readNativeHarnessActive, readNativeHarnessPermissions, readNativeHarnessForms, type NativeHarness } from '@/lib/opencode/native-harness';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { applyGlobalSessionStatusSnapshot, useGlobalSessionStatusStore } from '@/sync/global-session-status';
import { applyNativeBlockingSnapshot, useGlobalBlockingRequestsStore } from '@/sync/global-blocking-requests';
import { getSyncChildStores, registerSessionDirectory } from '@/sync/sync-refs';
import type { State } from '@/sync/types';

const catalog = z.object({ engines: z.array(z.object({ id: z.enum(['opencode', 'claude', 'codex']), available: z.boolean() })) });
const owns = (harness: NativeHarness, id: string) => resolveSessionEngine({ id }) === harness;

/** Native results add their own scope; an absent native id never deletes an OpenCode record. */
export async function refreshNativeHarness(harness: NativeHarness, runtimeKey: string, signal: AbortSignal): Promise<void> {
  const sessionBaseline = useGlobalSessionsStore.getState().mutationRevision;
  const statusBaseline = useGlobalSessionStatusStore.getState().statusById;
  const pendingBaseline = useGlobalBlockingRequestsStore.getState().bySession;
  const directoryPendingBaseline = new Map<string, Pick<State, 'permission' | 'form' | 'session_status'>>();
  try {
    for (const directory of new Set(useGlobalSessionsStore.getState().activeSessions.map((session) => session.directory))) {
      const state = getSyncChildStores().getChild(directory)?.getState();
      if (state) directoryPendingBaseline.set(directory, { permission: state.permission, form: state.form, session_status: state.session_status });
    }
  } catch { /* A global bootstrap can precede the sync provider mount. */ }
  const current = () => !signal.aborted && getRuntimeKey() === runtimeKey && !useConfigStore.getState().isConnected;
  const sessions = await readNativeHarnessSessions(harness, signal);
  if (!current()) return;
  const state = useGlobalSessionsStore.getState();
  const admitted = sessions.filter((session) => owns(harness, session.id) && (state.mutationRevisionBySessionId.get(session.id) ?? 0) <= sessionBaseline);
  state.upsertSessions(admitted);
  for (const session of admitted) {
    registerSessionDirectory(session.id, session.directory);
    try {
      const store = getSyncChildStores().getChild(session.directory);
      if (store) store.setState((previous) => ({ session: [...previous.session.filter((entry) => entry.id !== session.id), session] }));
    } catch { /* Before the provider mounts, the global record still routes detail reads. */ }
  }
  const directories = new Map(admitted.map((session) => [session.id, session.directory]));
  const resolveDirectory = (id: string) => directories.get(id) ?? useGlobalSessionsStore.getState().entityById.get(id)?.directory ?? '';

  // Each snapshot has its own failure boundary: a permission read cannot erase a valid session list.
  await Promise.allSettled([
    (async () => {
      const active = await readNativeHarnessActive(harness, signal);
      if (!current()) return;
      const now = useGlobalSessionStatusStore.getState().statusById;
      const ids = new Set([...directories.keys(), ...Object.keys(active), ...now.keys()].filter((id) => owns(harness, id)));
      const groups = new Map<string, string[]>();
      for (const id of ids) {
        if (now.get(id) !== statusBaseline.get(id)) continue;
        const directory = resolveDirectory(id) || now.get(id)?.directory;
        if (directory) groups.set(directory, [...(groups.get(directory) ?? []), id]);
      }
      for (const [directory, known] of groups) {
        const unchanged = new Set(known);
        const snapshot = Object.fromEntries(known.flatMap((id) => active[id] ? [[id, { type: 'busy' as const }]] : []));
        applyGlobalSessionStatusSnapshot(directory, snapshot, known, (id) => owns(harness, id) && unchanged.has(id));
        try {
          const store = getSyncChildStores().getChild(directory);
          const baseline = directoryPendingBaseline.get(directory)?.session_status;
          store?.setState((state) => {
            const session_status = { ...state.session_status };
            for (const id of known) {
              if (state.session_status[id] === baseline?.[id]) session_status[id] = active[id] ? { type: 'busy' } : { type: 'idle' };
            }
            return { session_status };
          });
        } catch { /* The global activity index remains available before the directory mounts. */ }
      }
    })(),
    (async () => {
      const [permissions, forms] = await Promise.all([readNativeHarnessPermissions(harness, signal), readNativeHarnessForms(harness, signal)]);
      if (!current()) return;
      applyNativeBlockingSnapshot((id) => owns(harness, id), resolveDirectory, permissions, forms,
        (id) => useGlobalBlockingRequestsStore.getState().bySession.get(id) === pendingBaseline.get(id));
      for (const directory of new Set([...directories.values(), ...directoryPendingBaseline.keys()])) {
        let store;
        try { store = getSyncChildStores().getChild(directory); } catch { continue; }
        if (!store) continue;
        const baseline = directoryPendingBaseline.get(directory);
        store.setState((state) => {
          const permission = { ...state.permission };
          const form = { ...state.form };
          const ids = new Set([...Object.keys(permission), ...Object.keys(form), ...directories.keys()]);
          for (const id of ids) {
            if (!owns(harness, id) || resolveDirectory(id) !== directory) continue;
            if (state.permission[id] === baseline?.permission[id]) permission[id] = permissions.filter((request) => request.sessionID === id);
            if (state.form[id] === baseline?.form[id]) form[id] = forms.filter((request) => request.sessionID === id);
          }
          return { permission, form };
        });
      }
    })(),
  ]);

}

export function useNativeHarnessBootstrap(enabled: boolean): void {
  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const runtimeKey = getRuntimeKey();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const response = await runtimeFetch('/api/engines', { signal: controller.signal });
        if (!response.ok) throw new Error('Engine catalog unavailable');
        const engines = catalog.parse(await response.json()).engines;
        await Promise.allSettled(engines.filter((engine) => engine.available && engine.id !== 'opencode').map((engine) =>
          engine.id === 'claude' || engine.id === 'codex' ? refreshNativeHarness(engine.id, runtimeKey, controller.signal) : Promise.resolve()));
      } catch { /* Failed scope reads preserve its last known records. */ }
      if (!controller.signal.aborted && runtimeKey === getRuntimeKey()) timer = setTimeout(() => { void refresh(); }, 45_000);
    };
    void refresh();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [enabled]);
}
