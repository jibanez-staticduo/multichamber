import { opencodeClient } from '@/lib/opencode/client';
import type { ModelRef, Session } from '@/lib/opencode/model';
import { requestSessionMetadataUpdate } from '@/sync/session-archive-batch';
import { getMultiRunMembership, multiRunMembershipPatch, withMultiRunMembership, type MultiRunIdentity } from './identity';

/** Bind the server-assigned ID before dispatch. A fork inherits this ID and cannot join. */
export async function createMultiRunSession(
  input: {
    title: string;
    directory: string;
    identity: Omit<MultiRunIdentity, 'key'>;
    /** Model and agent the run is pinned to; v2 sets them on the session, not per prompt. */
    selection?: { model?: ModelRef; agent?: string };
  },
  assertCurrent: () => void,
): Promise<Session> {
  assertCurrent();
  const membership = { ...input.identity, version: 1 as const, sessionID: null };
  const harness = input.identity.harness ?? 'opencode';
  const native = harness !== 'opencode';
  const nativeSelection = native ? {
    model: input.selection?.model?.id ?? input.identity.modelID,
    ...(input.selection?.model?.variant ? { effort: input.selection.model.variant } : {}),
    ...(input.identity.mode ? { mode: input.identity.mode } : {}),
  } : null;
  const metadata = withMultiRunMembership(nativeSelection ? { metadata: { backend: harness, [harness]: nativeSelection } } : {}, membership);
  const session = await opencodeClient.createSession({
    title: input.title,
    model: native ? { ...input.selection?.model, providerID: harness, id: nativeSelection?.model ?? input.identity.modelID } : input.selection?.model,
    agent: native ? undefined : input.selection?.agent,
    metadata,
  }, input.directory);
  try {
    assertCurrent();
    // OpenCode 2.x takes metadata only at creation, so the ID is bound through
    // Multichamber's own metadata route. It applies an RFC 7386 merge patch, so
    // only the marker travels and nothing another feature wrote under
    // `openchamber` in the meantime is replaced — no read-modify-write needed.
    const result = await requestSessionMetadataUpdate(
      session.id,
      multiRunMembershipPatch({ ...membership, sessionID: session.id }),
    );
    assertCurrent();
    if (result.outcome !== 'updated') throw new Error(`Multi-run membership was not saved: ${result.reason}`);
    const bound: Session = { ...session, metadata: result.metadata };
    if (!getMultiRunMembership(bound)) throw new Error('Multi-run membership was not saved');
    return bound;
  } catch (error) {
    // Never delete through a switched runtime. The pending marker remains ineligible.
    assertCurrent();
    try {
      await opencodeClient.deleteSession(session.id, input.directory);
    } catch {
      console.warn('[MultiRun] Could not remove an undispatched session after membership failure');
    }
    throw error;
  }
}
