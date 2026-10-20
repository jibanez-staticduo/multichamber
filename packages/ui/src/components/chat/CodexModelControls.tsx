import React from 'react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { fetchCodexModelCatalog, codexEffortsForModel, codexModeLabelKey, selectCodexMode, selectCodexModel, type CodexModelCatalog } from '@/lib/codexModels';
import { getCodexEngineState } from '@/lib/codexSessionMetadata';
import { useSession } from '@/sync/sync-context';

export const CodexModelControls: React.FC<{ sessionId: string; directory?: string; className?: string }> = ({ sessionId, directory, className }) => {
  const { t } = useI18n();
  const runtimeKey = getRuntimeKey();
  const session = useSession(sessionId, directory);
  const state = getCodexEngineState(session);
  const [catalog, setCatalog] = React.useState<CodexModelCatalog | null>(null);
  const [loadedRuntime, setLoadedRuntime] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  // Successful picks stand until the corresponding authoritative record changes.
  const [pick, setPick] = React.useState<{ source: string; model: string; effort: string; mode: string } | null>(null);
  const source = JSON.stringify([runtimeKey, sessionId, session?.model, state.model, state.effort, state.mode]);
  const currentPick = pick?.source === source ? pick : null;
  const model = currentPick?.model || session?.model?.id || state.model || catalog?.defaultModelId || '';
  const effort = currentPick?.effort ?? session?.model?.variant ?? state.effort ?? catalog?.defaultEffort ?? '';
  const mode = currentPick?.mode ?? state.mode ?? '';
  React.useEffect(() => {
    let cancelled = false;
    void fetchCodexModelCatalog().then((value) => { if (!cancelled) { setCatalog(value); setLoadedRuntime(runtimeKey); } });
    return () => { cancelled = true; };
  }, [runtimeKey]);

  const change = async (next: { model: string; effort: string; mode: string }, changingMode: boolean) => {
    setPending(true);
    const ok = changingMode ? await selectCodexMode(sessionId, next.mode) : await selectCodexModel(sessionId, { id: next.model, variant: next.effort || undefined });
    setPending(false);
    if (getRuntimeKey() !== runtimeKey) return;
    if (ok) setPick({ source, ...next });
    else toast.error(t(changingMode ? 'chat.codexMode.changeFailed' : 'chat.codexModel.changeFailed'));
  };
  if (loadedRuntime !== runtimeKey) return <span className="typography-meta text-muted-foreground">Codex</span>;
  if (!catalog) return <span className="typography-meta text-muted-foreground">{t('chat.codexCatalog.failed')}</span>;
  const efforts = codexEffortsForModel(catalog, model);
  const groups = [
    { kind: 'model', label: t('chat.modelControls.model'), value: model, options: catalog.models },
    { kind: 'effort', label: t('chat.modelControls.thinking'), value: effort, options: efforts },
    { kind: 'mode', label: t('chat.codexMode.title'), value: mode, options: catalog.modes.map((option) => {
      const labelKey = codexModeLabelKey(option.id);
      return { ...option, label: labelKey ? t(labelKey) : option.label };
    }) },
  ] as const;
  return <div className={cn('flex items-center justify-end min-w-0 gap-1', className)}>
    {groups.filter((group) => group.options.length > 0).map((group) => <DropdownMenu key={group.kind}>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" disabled={pending} aria-label={group.label} className="min-w-0 px-1.5 typography-meta truncate">{group.options.find((option) => option.id === group.value)?.label ?? (group.kind === 'mode' && !group.value ? t('settings.multichamber.about.state.unknown') : group.value)}</Button></DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end"><DropdownMenuLabel>{group.label}</DropdownMenuLabel>
        {group.options.map((option) => <DropdownMenuItem key={option.id} className={group.kind === 'mode' && catalog.modes.find((entry) => entry.id === option.id)?.dangerous ? 'text-[var(--status-error)]' : undefined} onSelect={() => {
          const next = { model, effort, mode, [group.kind]: option.id };
          if (group.kind === 'model') {
            const available = codexEffortsForModel(catalog, option.id);
            if (!available.some((entry) => entry.id === effort)) next.effort = catalog.models.find((entry) => entry.id === option.id)?.defaultReasoningEffort ?? available[0]?.id ?? '';
          }
          void change(next, group.kind === 'mode');
        }}>{option.label}</DropdownMenuItem>)}
      </DropdownMenuContent>
    </DropdownMenu>)}
  </div>;
};
