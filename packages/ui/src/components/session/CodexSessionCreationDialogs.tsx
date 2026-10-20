import React from 'react';
import { sessionEvents, type NewCodexSessionRequest } from '@/lib/sessionEvents';
import { NewCodexSessionDialog } from './NewCodexSessionDialog';

/** Shared by desktop and mobile so every creation entrypoint reaches the picker. */
export function CodexSessionCreationDialogs() {
  const [request, setRequest] = React.useState<NewCodexSessionRequest | null>(null);
  React.useEffect(() => sessionEvents.onNewCodexSessionRequest(setRequest), []);
  return request ? <NewCodexSessionDialog open onOpenChange={(open) => { if (!open) setRequest(null); }} directory={request.directory} onCreated={request.onCreated} /> : null;
}
