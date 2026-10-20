import { SESSION_SOURCE_FILTERS, SESSION_SOURCE_LABEL_KEYS } from '@/lib/sessionSourceFilter';
import { useSessionSourceFilterStore } from '@/stores/useSessionSourceFilterStore';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SessionEngineGlyph } from './SessionEngineGlyph';

export function SessionSourcePicker() {
  const { t } = useI18n();
  const filter = useSessionSourceFilterStore((state) => state.filter);
  const setFilter = useSessionSourceFilterStore((state) => state.setFilter);

  return (
    <div className="inline-flex max-w-full gap-1" role="group" aria-label={t('sessions.sidebar.header.sourceFilter.label')}>
      {SESSION_SOURCE_FILTERS.map((source) => {
        const label = t(SESSION_SOURCE_LABEL_KEYS[source]);
        return (
          <Tooltip key={source}>
            <TooltipTrigger asChild>
              <Button variant="chip" size="icon" className="pointer-coarse:size-11" aria-label={label} title={label} aria-pressed={filter === source} onClick={() => setFilter(source)}>
                {source === 'all' ? <Icon name="apps" className="size-4" aria-hidden="true" /> : <SessionEngineGlyph engine={source} className="size-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4}>{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
