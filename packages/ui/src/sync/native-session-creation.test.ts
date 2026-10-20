import { afterEach, expect, test } from 'bun:test';
import { opencodeClient } from '@/lib/opencode/client';
import { ChildStoreManager } from './child-store';
import { setOptimisticRefs, setActionRefs } from './session-actions';
import { useSessionUIStore } from './session-ui-store';
import { useConfigStore } from '@/stores/useConfigStore';
import type { Session } from '@/lib/opencode/model';
const originalCreate = opencodeClient.createSession;
const originalState = useSessionUIStore.getState();
afterEach(() => { opencodeClient.createSession = originalCreate; useSessionUIStore.setState(originalState); });

for (const harness of ['claude', 'codex'] as const) {
  test(`the central ${harness} creation action creates immediately using native defaults without OpenCode models`, async () => {
    const stores = new ChildStoreManager();
    setActionRefs(stores, () => '/repo');
    setOptimisticRefs(() => {}, () => {});
    useConfigStore.setState({ currentProviderId: '', currentModelId: '', providers: [], isConnected: false, hasEverConnected: false });
    let created: Parameters<typeof opencodeClient.createSession>[0] | undefined;
    const session: Session = { id: harness === 'codex' ? 'ses_cdxcreated' : 'ses_ccccreated', directory: '/repo', projectID: 'project', title: 'native', time: { created: 1, updated: 1 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, metadata: { backend: harness } };
    opencodeClient.createSession = async (input) => { created = input; return session; };
    try {
      useSessionUIStore.getState().openNewSessionDraft({ harness, resolvedHarness: true, directoryOverride: '/repo', target: 'project', preserveDirectoryOverride: true });
      for (let index = 0; index < 20 && !created; index++) await new Promise((resolve) => setTimeout(resolve, 0));
      expect(created).toMatchObject({ metadata: { backend: harness } });
      expect(created?.model).toBeUndefined();
      expect(useSessionUIStore.getState().currentSessionId).toBe(session.id);
      expect(useSessionUIStore.getState().newSessionDraft.open).toBe(false);
    } finally { stores.disposeAll(); }
  });
}

for (const harness of ['claude', 'codex'] as const) {
  test(`${harness} sends before OpenCode's first connection`, async () => {
    const stores = new ChildStoreManager();
    setActionRefs(stores, () => '/repo');
    setOptimisticRefs(() => {}, () => {});
    const originalFetch = globalThis.fetch;
    const originalSend = opencodeClient.sendMessage;
    const id = harness === 'codex' ? 'ses_cdxactive' : 'ses_cccactive';
    const session: Session = { id, directory: '/repo', projectID: 'project', title: 'native', time: { created: 1, updated: 1 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, metadata: { backend: harness } };
    const store = stores.ensureChild('/repo', { bootstrap: false });
    store.setState({ session: [session], message: { [id]: [] } });
    useSessionUIStore.setState({ currentSessionId: id, currentSessionDirectory: '/repo', newSessionDraft: { ...originalState.newSessionDraft, open: false } });
    useConfigStore.setState({ providers: [], currentProviderId: '', currentModelId: '', currentAgentName: '', isConnected: false, hasEverConnected: false });
    let sends = 0;
    globalThis.fetch = async () => Response.json({ synced: true });
    opencodeClient.sendMessage = async () => { sends++; return 'msg-native'; };
    try {
      const send = useSessionUIStore.getState().sendMessage('native prompt', harness, '', undefined, undefined, undefined, undefined, undefined, 'normal');
      const outcome = await Promise.race([send.then(() => 'sent'), new Promise((resolve) => setTimeout(() => resolve('blocked'), 150))]);
      expect(outcome).toBe('sent');
      expect(sends).toBe(1);
    } finally { globalThis.fetch = originalFetch; opencodeClient.sendMessage = originalSend; stores.disposeAll(); }
  });
}

test('native permissions settle before OpenCode ever connects', async () => {
  const stores = new ChildStoreManager();
  setActionRefs(stores, () => '/repo');
  const { respondToPermission } = await import('./session-actions');
  const originalReply = opencodeClient.replyToPermission;
  useConfigStore.setState({ isConnected: false, hasEverConnected: false });
  let replies = 0;
  opencodeClient.replyToPermission = async () => { replies++; return true; };
  try {
    const outcome = await Promise.race([respondToPermission('ses_cdxactive', 'permission', 'once', '/repo').then(() => 'replied'), new Promise((resolve) => setTimeout(() => resolve('blocked'), 150))]);
    expect(outcome).toBe('replied');
    expect(replies).toBe(1);
  } finally { opencodeClient.replyToPermission = originalReply; stores.disposeAll(); }
});

test('immediate native creation retains visible prompt and hidden synthetic instructions', async () => {
  const stores = new ChildStoreManager(); setActionRefs(stores, () => '/repo');
  const { useInputStore } = await import('./input-store');
  const session: Session = { id: 'ses_cdxcontext', directory: '/repo', projectID: 'project', title: 'native', time: { created: 1, updated: 1 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, metadata: { backend: 'codex' } };
  opencodeClient.createSession = async () => session;
  try {
    let done = false;
    useSessionUIStore.getState().openNewSessionDraft({ harness: 'codex', resolvedHarness: true, target: 'project', directoryOverride: '/repo', preserveDirectoryOverride: true, initialPrompt: 'Resolve this conflict', syntheticParts: [{ text: 'Hidden source instructions', synthetic: true }], onCreated: () => { done = true; } });
    for (let i = 0; i < 20 && !done; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useInputStore.getState().pendingInputText).toBe('Resolve this conflict');
    expect(useInputStore.getState().pendingSyntheticParts).toEqual([{ text: 'Hidden source instructions', synthetic: true }]);
    expect(useSessionUIStore.getState().currentSessionId).toBe('ses_cdxcontext');
  } finally { stores.disposeAll(); }
});

test('a delayed native create cannot close or navigate over a newer draft', async () => {
  const stores = new ChildStoreManager(); setActionRefs(stores, () => '/repo');
  let finish: ((session: Session) => void) | undefined;
  opencodeClient.createSession = () => new Promise((resolve) => { finish = resolve; });
  const session: Session = { id: 'ses_cdxold-request', directory: '/repo', projectID: 'project', title: 'native', time: { created: 1, updated: 1 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, metadata: { backend: 'codex' } };
  try {
    useSessionUIStore.getState().openNewSessionDraft({ harness: 'codex', resolvedHarness: true, target: 'project', directoryOverride: '/repo', preserveDirectoryOverride: true });
    for (let i = 0; i < 20 && !finish; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    useSessionUIStore.getState().openNewSessionDraft({ harness: 'opencode', resolvedHarness: true, target: 'project', directoryOverride: '/new-project', preserveDirectoryOverride: true });
    const newer = useSessionUIStore.getState().newSessionDraft.draftId;
    finish?.(session);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(useSessionUIStore.getState().newSessionDraft).toMatchObject({ draftId: newer, open: true, directoryOverride: '/new-project' });
    expect(useSessionUIStore.getState().currentSessionId).toBeNull();
    expect(stores.getChild('/repo')?.getState().session.some((entry) => entry.id === session.id)).toBe(true);
  } finally { stores.disposeAll(); }
});
