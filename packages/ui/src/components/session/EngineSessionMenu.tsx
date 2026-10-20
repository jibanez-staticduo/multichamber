import React from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useSessionEngineAvailability } from '@/hooks/useSessionEngine';
import { requestSessionCreation } from '@/lib/sessionCreation';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { SessionEngineGlyph } from './SessionEngineGlyph';

/** The primary action uses saved defaults; the adjacent menu explicitly chooses a harness. */
export function EngineSessionMenu({ directory, onOpenCode, children }: { directory?: string | null; onOpenCode: () => void; children: React.ReactElement<React.HTMLAttributes<HTMLElement>> }) {
  const { t } = useI18n();
  const claude = useSessionEngineAvailability('claude');
  const codex = useSessionEngineAvailability('codex');
  const choose = (harness: 'opencode' | 'claude' | 'codex') => {
    void requestSessionCreation({ harness, persistHarnessChoice: true, directoryOverride: directory, target: directory ? 'project' : 'chat' }).catch((error) => useSessionUIStore.setState({ error: error instanceof Error ? error.message : String(error) }));
  };
  return <span className="inline-flex items-center gap-0.5">
    {React.cloneElement(children, { onClick: (event) => { event.stopPropagation(); onOpenCode(); } })}
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="xs" aria-label={t('sessions.creation.chooseHarness')}><Icon name="arrow-down-s" className="size-3" /></Button></DropdownMenuTrigger><DropdownMenuContent>
      <DropdownMenuItem onClick={() => choose('opencode')}><SessionEngineGlyph engine="opencode" className="size-4" />OpenCode</DropdownMenuItem>
      {claude ? <DropdownMenuItem onClick={() => choose('claude')}><SessionEngineGlyph engine="claude" className="size-4" />Claude Code</DropdownMenuItem> : null}
      {codex ? <DropdownMenuItem onClick={() => choose('codex')}><SessionEngineGlyph engine="codex" className="size-4" />Codex</DropdownMenuItem> : null}
    </DropdownMenuContent></DropdownMenu>
  </span>;
}
