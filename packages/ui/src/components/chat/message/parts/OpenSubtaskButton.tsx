import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { RuntimeAPIContext } from '@/contexts/runtimeAPIContext';
import { useChatColumnActions } from '@/components/chat/chatColumnSession';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useUIStore } from '@/stores/useUIStore';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Header action of a subagent row: opens the child session, whose own chat shows its work. */
export const OpenSubtaskButton: React.FC<{
    directory: string | undefined;
    sessionId: string;
    agent: string | undefined;
    isMobile: boolean;
}> = ({ sessionId, agent, isMobile, directory: currentDirectory }) => {
    const { t } = useI18n();
    const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
    const column = useChatColumnActions();
    const openContextPanelTab = useUIStore((state) => state.openContextPanelTab);
    const runtime = React.useContext(RuntimeAPIContext);

    const agentType = agent ?? 'subagent';
    const agentLabel = agentType.charAt(0).toUpperCase() + agentType.slice(1);
    const label = t('chat.toolPart.openSubtask', { type: agentLabel });

    const handleOpen = (event: React.MouseEvent) => {
        event.stopPropagation();
        if (!currentDirectory) return;
        // A chat already in the side panel opens the subtask in place.
        if (column.pinned) {
            column.openSession(sessionId, currentDirectory);
            return;
        }
        // Single-surface layouts (mobile, VS Code) navigate in place.
        // Otherwise open a new side-panel tab.
        if (isMobile || runtime?.runtime.isVSCode) {
            setCurrentSession(sessionId, currentDirectory);
            return;
        }
        openContextPanelTab(currentDirectory, {
            mode: 'chat',
            dedupeKey: `session:${sessionId}`,
            label: agentLabel,
            readOnly: true,
        });
    };

    return (
        <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={handleOpen}
            className={cn(
                'flex-shrink-0 inline-flex h-4 w-4 items-center justify-center rounded transition-opacity hover:bg-interactive-hover',
                'opacity-60 hover:opacity-100 focus-visible:opacity-100',
            )}
            style={{ color: 'var(--tools-icon)' }}
            title={label}
            aria-label={label}
        >
            <Icon name="external-link" className="h-3 w-3" />
        </button>
    );
};
