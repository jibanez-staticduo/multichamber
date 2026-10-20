import { spaceIdOfDirectory } from '@/lib/spaces/space-route';
import { formatMessage, useI18nStore } from '@/lib/i18n';
import { loadDesktopSettings, updateDesktopSettings } from '@/lib/persistence';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { SESSION_ENGINE_INFO, isSessionEngine, type SessionEngine } from '@/lib/sessionEngine';
import { selectEngineTable, useEngineStore } from '@/stores/useEngineStore';
import { useSessionUIStore, type NewSessionDraftState } from '@/sync/session-ui-store';

export type SessionCreationOptions = Partial<NewSessionDraftState> & { harness?: SessionEngine; automatic?: boolean; persistHarnessChoice?: boolean; onCreated?: (session: import('@/lib/opencode/model').Session | null) => void };

/** Every user entrypoint resolves the host's saved harness before changing its draft or filesystem. */
export async function requestSessionCreation(options?: SessionCreationOptions): Promise<void> {
  const runtimeKey = getRuntimeKey();
  const assertRuntime = () => { if (getRuntimeKey() !== runtimeKey) throw new DOMException('Session creation was cancelled because the runtime changed', 'AbortError'); };
  const settings = await loadDesktopSettings();
  assertRuntime();
  if (!settings) throw new Error(formatMessage(useI18nStore.getState().dictionary, 'sessions.creation.failed', { engine: options?.harness ?? 'OpenCode' }));
  const harness = options?.harness ?? (isSessionEngine(settings.defaultHarness) ? settings.defaultHarness : 'opencode');
  await useEngineStore.getState().load(runtimeKey);
  assertRuntime();
  const engine = selectEngineTable(useEngineStore.getState(), runtimeKey)[harness];
  if (!engine.available) throw new Error(formatMessage(useI18nStore.getState().dictionary, 'sessions.creation.unavailable', { engine: engine.label }));
  if (harness !== 'opencode' && (options?.pendingWorktreeRequestId || options?.bootstrapPendingDirectory || spaceIdOfDirectory(options?.directoryOverride))) throw new Error(formatMessage(useI18nStore.getState().dictionary, 'sessions.creation.unsupportedTarget', { engine: engine.label }));
  if (options?.persistHarnessChoice) await updateDesktopSettings({ defaultHarness: harness });
  assertRuntime();
  if (harness !== 'opencode' && !options?.automatic) {
    await new Promise<void>((resolve, reject) => {
      useSessionUIStore.getState().openNewSessionDraft({ ...options, harness, resolvedHarness: true, onCreated: (session) => { if (getRuntimeKey() !== runtimeKey) { reject(new DOMException('Session creation was cancelled because the runtime changed', 'AbortError')); return; } options?.onCreated?.(session); if (session) resolve(); else reject(new Error(formatMessage(useI18nStore.getState().dictionary, 'sessions.creation.failed', { engine: engine.label }))); } });
    });
  } else useSessionUIStore.getState().openNewSessionDraft({ ...options, harness, resolvedHarness: true });
  assertRuntime();
}

/** Worktree/space setup currently belongs to OpenCode and must refuse before allocating resources. */
export async function assertOpenCodeCreationTarget(): Promise<void> {
  const settings = await loadDesktopSettings();
  if (!settings) throw new Error(formatMessage(useI18nStore.getState().dictionary, 'sessions.creation.failed', { engine: 'OpenCode' }));
  if (isSessionEngine(settings.defaultHarness) && settings.defaultHarness !== 'opencode') throw new Error(formatMessage(useI18nStore.getState().dictionary, 'sessions.creation.unsupportedTarget', { engine: SESSION_ENGINE_INFO[settings.defaultHarness].label }));
}
