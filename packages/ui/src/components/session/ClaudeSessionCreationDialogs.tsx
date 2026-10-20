import React from 'react';
import { ClaudeAccountDialog } from '@/components/chat/ClaudeAccountDialog';
import { sessionEvents, type NewClaudeSessionRequest } from '@/lib/sessionEvents';
import { NewClaudeSessionDialog } from './NewClaudeSessionDialog';
export function ClaudeSessionCreationDialogs() {
  const [request, setRequest] = React.useState<NewClaudeSessionRequest | null>(null);
  React.useEffect(() => sessionEvents.onNewClaudeSessionRequest(setRequest), []);
  const [accountOpen, setAccountOpen] = React.useState(false);
  React.useEffect(() => { const listener = () => setAccountOpen(true); window.addEventListener('openchamber:claude-account', listener); return () => window.removeEventListener('openchamber:claude-account', listener); }, []);
  return <><ClaudeAccountDialog open={accountOpen} onOpenChange={setAccountOpen} />{request ? <NewClaudeSessionDialog open onOpenChange={(open) => { if (!open) setRequest(null); }} directory={request.directory} onCreated={request.onCreated} /> : null}</>;
}
