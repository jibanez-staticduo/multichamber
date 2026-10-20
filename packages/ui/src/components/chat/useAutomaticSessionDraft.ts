import React from 'react';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { requestSessionCreation } from '@/lib/sessionCreation';
import { useConfigStore } from '@/stores/useConfigStore';
import { useEngineStore } from '@/stores/useEngineStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

/** Cold mobile mounts before defaults and the native catalog have answered. */
export function useAutomaticSessionDraft(enabled: boolean): void {
  const sessionId = useSessionUIStore((state) => state.currentSessionId);
  const draftOpen = useSessionUIStore((state) => state.newSessionDraft.open);
  const defaultsLoaded = useConfigStore((state) => state.settingsDefaultsLoaded);
  const nativeRuntime = useConfigStore((state) => state.nativeReadyRuntimeKey);
  const runtimeKey = getRuntimeKey();
  const engines = useEngineStore((state) => state.byRuntime[runtimeKey]);
  const pending = React.useRef<string | null>(null);
  const attempted = React.useRef<{ runtime: string; engines: typeof engines; defaultsLoaded: boolean } | null>(null);
  React.useEffect(() => {
    if (enabled && defaultsLoaded && nativeRuntime === runtimeKey && !engines) void useEngineStore.getState().load(runtimeKey);
  }, [enabled, defaultsLoaded, nativeRuntime, runtimeKey, engines]);
  React.useEffect(() => {
    if (sessionId || draftOpen) attempted.current = null;
    if (!enabled || sessionId || draftOpen || !defaultsLoaded || pending.current === runtimeKey) return;
    if (nativeRuntime === runtimeKey && !engines) return;
    const live = useSessionUIStore.getState();
    if (live.currentSessionId || live.newSessionDraft.open) return;
    if (attempted.current?.runtime === runtimeKey && attempted.current.engines === engines && attempted.current.defaultsLoaded === defaultsLoaded) return;
    attempted.current = { runtime: runtimeKey, engines, defaultsLoaded };
    pending.current = runtimeKey;
    void requestSessionCreation({ automatic: true }).catch((error) => {
      if (getRuntimeKey() === runtimeKey) useSessionUIStore.setState({ error: error instanceof Error ? error.message : String(error) });
    }).finally(() => { if (pending.current === runtimeKey) pending.current = null; });
  }, [enabled, sessionId, draftOpen, defaultsLoaded, nativeRuntime, runtimeKey, engines]);
}
