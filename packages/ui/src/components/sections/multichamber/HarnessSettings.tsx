import React from 'react';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SettingsSection, SettingsFieldRow, SETTINGS_SELECT_ROW_TRIGGER_CLASS } from '../shared/SettingsSection';
import { loadDesktopSettings, updateDesktopSettings } from '@/lib/persistence';
import { useI18n } from '@/lib/i18n';
import { getRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import { SESSION_ENGINE_INFO } from '@/lib/sessionEngine';
import { codexModeLabelKey } from '@/lib/codexModels';
import { harnessIdSchema, harnessSettingKeys, readHarnesses, readNativeCatalog, checkHarness, updateHarness, type HarnessId, type HarnessStatus, type NativeCatalog } from '@/lib/settings/harnesses';
import type { DesktopSettings } from '@/lib/settings/registry';

const NATIVE_DEFAULT = '__native_default__';
function useHarnessRuntimeKey() {
  const [key, setKey] = React.useState(getRuntimeKey);
  React.useEffect(() => subscribeRuntimeEndpointChanged(() => setKey(getRuntimeKey())), []);
  return key;
}
const claudeModeKeys = {
  default: 'chat.claudeMode.default', acceptEdits: 'chat.claudeMode.acceptEdits', plan: 'chat.claudeMode.plan', auto: 'chat.claudeMode.auto', bypassPermissions: 'chat.claudeMode.bypassPermissions',
} as const;
function nativeModeKey(id: string, mode: string) {
  if (id === 'codex') return codexModeLabelKey(mode);
  switch (mode) {
    case 'default': return claudeModeKeys.default;
    case 'acceptEdits': return claudeModeKeys.acceptEdits;
    case 'plan': return claudeModeKeys.plan;
    case 'auto': return claudeModeKeys.auto;
    case 'bypassPermissions': return claudeModeKeys.bypassPermissions;
    default: return null;
  }
}

function HarnessRuntimeRow({ harness }: { harness: HarnessStatus }) {
  const { t } = useI18n();
  const [state, setState] = React.useState(harness);
  const [checking, setChecking] = React.useState(false);
  const [updating, setUpdating] = React.useState(false);
  const [updated, setUpdated] = React.useState(false);
  const [updateFailed, setUpdateFailed] = React.useState(false);
  const updateLock = React.useRef(false);
  const confirmation = useConfirmDialog();
  const [failed, setFailed] = React.useState(false);
  const runtime = useHarnessRuntimeKey();
  const check = async () => {
    setChecking(true);
    setFailed(false);
    try {
      const next = await checkHarness(harness.id);
      if (getRuntimeKey() === runtime) setState(next);
    } catch { if (getRuntimeKey() === runtime) setFailed(true); }
    finally { if (getRuntimeKey() === runtime) setChecking(false); }
  };
  const install = async () => {
    if (updateLock.current || state.id === 'opencode' || state.update.status !== 'available') return;
    updateLock.current = true;
    setUpdating(true);
    setUpdated(false);
    setUpdateFailed(false);
    try {
      const accepted = await confirmation.confirm({ title: t('settings.harnesses.confirmTitle', { engine: SESSION_ENGINE_INFO[state.id].label }), message: t('settings.harnesses.confirmMessage'), action: t('settings.harnesses.installUpdate') });
      if (!accepted || getRuntimeKey() !== runtime) return;
      const result = await updateHarness(state.id);
      if (getRuntimeKey() !== runtime) return;
      setState(result.harness);
      setUpdated(result.status === 'updated');
    } catch { if (getRuntimeKey() === runtime) setUpdateFailed(true); }
    finally { updateLock.current = false; if (getRuntimeKey() === runtime) setUpdating(false); }
  };
  return <> <SettingsFieldRow settingsItem={`sessions.harness-${harness.id}-runtime`} label={SESSION_ENGINE_INFO[harness.id].label} description={
    <span className="space-y-1">
      <span className="block">{t(state.installed ? state.running ? 'settings.harnesses.running' : 'settings.harnesses.installed' : 'settings.harnesses.notInstalled')} · {state.version ?? t('settings.harnesses.unknownVersion')}</span>
      {updated ? <span className="block">{t('settings.harnesses.updated')}</span> : null}
      {updateFailed ? <span className="block text-[var(--status-error)]">{t('settings.harnesses.updateFailed')}</span> : null}
      {state.latestVersion ? <span className="block">{t('settings.harnesses.latestVersion', { version: state.latestVersion })}</span> : null}
      {state.update.reason ? <span className="block">{t(state.update.reason === 'shared-authority' ? 'settings.harnesses.sharedOwner' : state.update.reason === 'enterprise_mode' ? 'settings.harnesses.policyBlocked' : state.update.reason === 'not-installed' ? 'settings.harnesses.notInstalled' : 'settings.harnesses.installerOwned')}</span> : null}
      {state.update.action ? <code className="block break-all text-xs">{state.update.action}</code> : null}
      {failed || state.checkError ? <span className="block text-[var(--status-error)]">{t('settings.harnesses.checkFailed')}</span> : null}
      <span className="block">{t(state.update.status === 'available' ? 'settings.harnesses.updateAvailable' : state.update.status === 'current' ? 'settings.harnesses.current' : state.update.status === 'manual' ? 'settings.harnesses.manualUpdate' : state.update.status === 'unsupported' ? 'settings.harnesses.unsupportedUpdate' : 'settings.harnesses.notChecked')}</span>
    </span>
  }><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={checking || updating} onClick={() => void check()}>{t(checking ? 'settings.harnesses.checking' : 'settings.harnesses.checkUpdates')}</Button>
    {state.id !== 'opencode' && state.update.status === 'available' ? <Button size="sm" disabled={checking || updating} onClick={() => void install()}>{t(updating ? 'settings.harnesses.updating' : 'settings.harnesses.installUpdate')}</Button> : null}</div></SettingsFieldRow>{confirmation.dialog}</>;
}

export function HarnessRuntimeSettings() {
  const runtime = useHarnessRuntimeKey();
  const { t } = useI18n();
  const [harnesses, setHarnesses] = React.useState<HarnessStatus[] | null>(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    setHarnesses(null);
    setFailed(false);
    void readHarnesses().then((value) => { if (active) setHarnesses(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [runtime]);
  return <SettingsSection title={t('settings.harnesses.runtimes')} info={t('settings.harnesses.runtimeInfo')}>
    {failed ? <p className="typography-meta text-[var(--status-error)]">{t('settings.harnesses.statusFailed')}</p> : null}
    {harnesses?.map((harness) => <HarnessRuntimeRow key={`${runtime}:${harness.id}`} harness={harness} />)}
  </SettingsSection>;
}

function NativeDefaults({ id, settings }: { id: 'claude' | 'codex'; settings: DesktopSettings }) {
  const { t } = useI18n();
  const [catalog, setCatalog] = React.useState<NativeCatalog | null>(null);
  const [picked, setPicked] = React.useState(settings);
  const [failed, setFailed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const runtime = useHarnessRuntimeKey();
  const keys = harnessSettingKeys[id];
  React.useEffect(() => {
    let active = true;
    setCatalog(null);
    setFailed(false);
    void readNativeCatalog(id).then((value) => { if (active) setCatalog(value); }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [id, runtime]);
  const change = async (field: 'model' | 'effort' | 'mode', value: string) => {
    const key = keys[field];
    const next = value === NATIVE_DEFAULT ? '' : value;
    setSaving(true);
    const changes = field === 'model' ? { [key]: next, [keys.effort]: '' } : { [key]: next };
    const result = await updateDesktopSettings(changes);
    if (getRuntimeKey() !== runtime) return;
    setSaving(false);
    if (result.ok) setPicked((previous) => ({ ...previous, ...changes }));
  };
  const model = picked[keys.model] || catalog?.defaultModelId;
  const supported = catalog?.models.find((option) => option.id === model)?.supportedReasoningEfforts;
  const efforts = supported ? catalog?.efforts.filter((option) => supported.some((entry) => entry.reasoningEffort === option.id)) ?? [] : catalog?.efforts ?? [];
  const rows = [
    { field: 'model', label: 'chat.modelControls.model', options: catalog?.models ?? [] },
    { field: 'effort', label: 'chat.modelControls.thinking', options: efforts },
    { field: 'mode', label: 'chat.codexMode.title', options: catalog?.modes ?? [] },
  ] as const;
  return <SettingsSection title={SESSION_ENGINE_INFO[id].label} info={t('settings.harnesses.nativeDefaultsInfo')}>
    {failed ? <p className="typography-meta text-[var(--status-error)]">{t('settings.harnesses.catalogFailed')}</p> : null}
    {rows.map((row) => <SettingsFieldRow key={row.field} settingsItem={`sessions.harness-${id}-${row.field}`} label={t(row.label)}>
      <Select value={picked[keys[row.field]] || NATIVE_DEFAULT} disabled={saving || !catalog} onValueChange={(value) => void change(row.field, value)}>
        <SelectTrigger className={SETTINGS_SELECT_ROW_TRIGGER_CLASS}><SelectValue>{(() => {
          const value = picked[keys[row.field]];
          if (!value) return t('settings.harnesses.nativeDefault');
          const modeKey = row.field === 'mode' ? nativeModeKey(id, value) : null;
          return modeKey ? t(modeKey) : row.options.find((option) => option.id === value)?.label ?? value;
        })()}</SelectValue></SelectTrigger>
        <SelectContent><SelectItem value={NATIVE_DEFAULT}>{t('settings.harnesses.nativeDefault')}</SelectItem>{row.options.map((option) => {
          const key = row.field === 'mode' ? nativeModeKey(id, option.id) : null;
          return <SelectItem key={option.id} value={option.id}>{key ? t(key) : option.label}</SelectItem>;
        })}</SelectContent>
      </Select>
    </SettingsFieldRow>)}
  </SettingsSection>;
}

export function HarnessDefaultsSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = React.useState<DesktopSettings | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const runtime = useHarnessRuntimeKey();
  React.useEffect(() => {
    let active = true;
    setSettings(null);
    setFailed(false);
    void loadDesktopSettings().then((value) => { if (active) { setSettings(value ?? {}); setFailed(value === null); } }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [runtime]);
  const change = async (value: string) => {
    const parsed = harnessIdSchema.safeParse(value);
    if (!parsed.success) return;
    setSaving(true);
    const result = await updateDesktopSettings({ defaultHarness: parsed.data });
    if (getRuntimeKey() !== runtime) return;
    setSaving(false);
    if (result.ok) setSettings((previous) => ({ ...previous, defaultHarness: parsed.data }));
  };
  return <>
    <SettingsSection divider={false} title={t('settings.harnesses.title')} info={t('settings.harnesses.scopeInfo')}>
      {failed ? <p className="typography-meta text-[var(--status-error)]">{t('settings.harnesses.statusFailed')}</p> : null}
      <SettingsFieldRow settingsItem="sessions.default-harness" label={t('settings.harnesses.defaultHarness')}>
        <Select value={settings?.defaultHarness ?? 'opencode'} disabled={!settings || saving || failed} onValueChange={(value) => void change(value)}><SelectTrigger className={SETTINGS_SELECT_ROW_TRIGGER_CLASS}><SelectValue>{SESSION_ENGINE_INFO[settings?.defaultHarness ?? 'opencode'].label}</SelectValue></SelectTrigger><SelectContent>{(['opencode', 'claude', 'codex'] as const).map((id: HarnessId) => <SelectItem key={id} value={id}>{SESSION_ENGINE_INFO[id].label}</SelectItem>)}</SelectContent></Select>
      </SettingsFieldRow>
    </SettingsSection>
    {settings && !failed ? <><NativeDefaults id="claude" settings={settings} /><NativeDefaults id="codex" settings={settings} /></> : null}
    <HarnessRuntimeSettings />
  </>;
}
