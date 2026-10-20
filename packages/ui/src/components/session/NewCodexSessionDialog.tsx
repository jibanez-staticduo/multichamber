import React from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useI18n } from '@/lib/i18n';
import { fetchCodexModelCatalog, codexEffortsForModel, codexModeLabelKey, type CodexModelCatalog } from '@/lib/codexModels';
import type { Session } from '@/lib/opencode/model';
import { createCodexSession } from '@/sync/session-actions';

export const NewCodexSessionDialog: React.FC<{ open: boolean; onOpenChange: (open: boolean) => void; directory: string; onCreated?: (session: Session | null) => void }> = ({ open, onOpenChange, directory, onCreated }) => {
  const { t } = useI18n();
  const runtimeKey = getRuntimeKey();
  const [loadedRuntime, setLoadedRuntime] = React.useState<string | null>(null);
  const [catalog, setCatalog] = React.useState<CodexModelCatalog | null>(null);
  const [model, setModel] = React.useState('');
  const [effort, setEffort] = React.useState('');
  const [mode, setMode] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    setCatalog(null);
    setModel('');
    setEffort('');
    setMode('');
    setLoadedRuntime(null);
    let cancelled = false;
    void fetchCodexModelCatalog().then((value) => {
      if (cancelled) return;
      if (getRuntimeKey() !== runtimeKey) return;
      setCatalog(value);
      setLoadedRuntime(runtimeKey);
      setModel(value?.defaultModelId ?? value?.models[0]?.id ?? '');
      setEffort(value?.defaultEffort ?? '');
      setMode(value?.defaultMode ?? '');
    });
    return () => { cancelled = true; };
  }, [open, runtimeKey]);
  const create = async () => {
    if (loadedRuntime !== runtimeKey || getRuntimeKey() !== runtimeKey || !catalog || !model) return;
    setCreating(true);
    const session = await createCodexSession(directory, { model, effort, mode }).catch(() => null);
    setCreating(false);
    if (getRuntimeKey() !== runtimeKey) return;
    if (!session) { toast.error(t('dialog.codexNew.failed')); return; }
    onCreated?.(session);
    onOpenChange(false);
  };
  const rows = [
    { kind: 'model', label: t('chat.modelControls.model'), value: model, options: catalog?.models ?? [] },
    { kind: 'effort', label: t('chat.modelControls.thinking'), value: effort, options: catalog ? codexEffortsForModel(catalog, model) : [] },
    { kind: 'mode', label: t('chat.codexMode.title'), value: mode, options: (catalog?.modes ?? []).map((option) => {
      const labelKey = codexModeLabelKey(option.id);
      return { ...option, label: labelKey ? t(labelKey) : option.label };
    }) },
  ] as const;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-[min(440px,calc(100vw-2rem))]">
    <DialogHeader><DialogTitle>{t('dialog.codexNew.title')}</DialogTitle><DialogDescription>{t('dialog.codexNew.description')}</DialogDescription></DialogHeader>
    <div className="typography-micro text-muted-foreground truncate" title={directory}>{directory}</div>
    {loadedRuntime === runtimeKey && !catalog ? <p className="typography-meta text-[var(--status-error)]">{t('chat.codexCatalog.failed')}</p> : null}
    <div className="space-y-3 py-2">{rows.filter((row) => row.options.length > 0).map((row) => <div key={row.kind} className="flex items-center justify-between gap-3">
      <span className="typography-meta text-foreground">{row.label}</span>
      <Select value={row.value} onValueChange={(value) => {
        if (row.kind === 'mode') setMode(value);
        else if (row.kind === 'effort') setEffort(value);
        else {
          setModel(value);
          if (catalog) {
            const available = codexEffortsForModel(catalog, value);
            if (!available.some((entry) => entry.id === effort)) setEffort(catalog.models.find((entry) => entry.id === value)?.defaultReasoningEffort ?? available[0]?.id ?? '');
          }
        }
      }}><SelectTrigger className="w-[min(240px,55vw)]" aria-label={row.label}><SelectValue>{row.options.find((option) => option.id === row.value)?.label ?? row.value}</SelectValue></SelectTrigger><SelectContent>{row.options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select>
    </div>)}</div>
    <DialogFooter><Button variant="ghost" onClick={() => onOpenChange(false)} disabled={creating}>{t('sessions.sidebar.dialogs.cancel')}</Button><Button disabled={creating || !model || loadedRuntime !== runtimeKey} onClick={() => void create()}>{t(creating ? 'dialog.codexNew.creating' : 'dialog.codexNew.create')}</Button></DialogFooter>
  </DialogContent></Dialog>;
};
