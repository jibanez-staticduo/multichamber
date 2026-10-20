import React from 'react';
import { codexModeLabelKey, fetchCodexModelCatalog } from '@/lib/codexModels';
import { fetchClaudeModelCatalog } from '@/lib/claudeModels';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

type Catalog = { models: { id: string; label: string; supportedReasoningEfforts?: { reasoningEffort: string; description: string }[]; defaultReasoningEffort?: string | null }[]; efforts: { id: string; label: string }[]; modes?: { id: string; label: string }[]; defaultModelId: string | null; defaultEffort: string | null; defaultMode?: string | null };

/** A native draft uses the host's own defaults before any session exists. */
export function NativeDraftModelControls({ harness }: { harness: 'claude' | 'codex' }) {
  const { t } = useI18n();
  const runtime = getRuntimeKey();
  const draft = useSessionUIStore((state) => state.newSessionDraft);
  const [retry, setRetry] = React.useState(0);
  const [loaded, setLoaded] = React.useState<{ runtime: string; harness: string; catalog: Catalog | null } | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void (harness === 'codex' ? fetchCodexModelCatalog() : fetchClaudeModelCatalog()).then((catalog) => { if (!cancelled) setLoaded({ runtime, harness, catalog }); });
    return () => { cancelled = true; };
  }, [runtime, harness, retry]);
  const catalog = loaded?.runtime === runtime && loaded.harness === harness ? loaded.catalog : null;
  if (!catalog) return <div className="flex items-center gap-1 typography-meta text-muted-foreground">{loaded?.runtime === runtime && loaded.harness === harness ? <><span>{t('sessions.creation.failed', { engine: harness === 'codex' ? 'Codex' : 'Claude Code' })}</span><Button variant="ghost" size="sm" onClick={() => setRetry((value) => value + 1)}>{t('directoryExplorerDialog.browse.retry')}</Button></> : harness === 'codex' ? 'Codex' : 'Claude Code'}</div>;
  const selection = draft.nativeSelection;
  const selectedModel = catalog.models.find((model) => model.id === (selection?.model ?? catalog.defaultModelId));
  const efforts = selectedModel?.supportedReasoningEfforts ? selectedModel.supportedReasoningEfforts.map((entry) => ({ id: entry.reasoningEffort, label: catalog.efforts.find((effort) => effort.id === entry.reasoningEffort)?.label ?? entry.reasoningEffort })) : catalog.efforts;
  const modeLabel = (id: string, label: string) => {
    const key = harness === 'codex' ? codexModeLabelKey(id) : id === 'default' ? 'chat.claudeMode.default' : id === 'acceptEdits' ? 'chat.claudeMode.acceptEdits' : id === 'plan' ? 'chat.claudeMode.plan' : id === 'auto' ? 'chat.claudeMode.auto' : id === 'bypassPermissions' ? 'chat.claudeMode.bypassPermissions' : null;
    return key ? t(key) : label;
  };
  const rows = [
    { key: 'model', label: t('chat.modelControls.model'), value: selection?.model ?? catalog.defaultModelId, options: catalog.models },
    { key: 'effort', label: t('chat.modelControls.thinking'), value: selection?.effort ?? catalog.defaultEffort, options: efforts },
    { key: 'mode', label: t(harness === 'codex' ? 'chat.codexMode.title' : 'chat.claudeMode.title'), value: selection?.mode ?? catalog.defaultMode, options: (catalog.modes ?? []).map((mode) => ({ ...mode, label: modeLabel(mode.id, mode.label) })) },
  ] as const;
  return <div className="flex min-w-0 items-center gap-1">{rows.filter((row) => row.options.length > 0).map((row) => <DropdownMenu key={row.key}><DropdownMenuTrigger asChild>
    <Button variant="ghost" size="sm" aria-label={row.label} className="min-w-0 truncate">{row.options.find((option) => option.id === row.value)?.label ?? row.value}</Button>
  </DropdownMenuTrigger><DropdownMenuContent>{row.options.map((option) => <DropdownMenuItem key={option.id} onClick={() => {
    if (runtime !== getRuntimeKey()) return;
    useSessionUIStore.setState((state) => state.newSessionDraft.draftId === draft.draftId ? { newSessionDraft: { ...state.newSessionDraft, nativeSelection: row.key === 'model' ? { ...state.newSessionDraft.nativeSelection, model: option.id, effort: catalog.models.find((model) => model.id === option.id)?.defaultReasoningEffort ?? catalog.models.find((model) => model.id === option.id)?.supportedReasoningEfforts?.[0]?.reasoningEffort ?? catalog.defaultEffort ?? undefined } : { ...state.newSessionDraft.nativeSelection, [row.key]: option.id } } } : state);
  }}>{option.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>)}</div>;
}
