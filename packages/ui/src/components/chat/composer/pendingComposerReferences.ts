import { create } from 'zustand';

import type { ComposerReference } from './composerReferences';

type PendingComposerReferences = {
    references: ComposerReference[];
    bySession: ReadonlyMap<string, ComposerReference[]>;
    push: (references: readonly ComposerReference[], sessionId?: string) => void;
    consume: (sessionId?: string) => ComposerReference[];
};

/**
 * Issues and PRs a flow outside the composer hands to the next draft: the New
 * Worktree dialog attaches the item it was created for this way. `ChatInput`
 * consumes them into its chips, like a guest panel's `pendingGuestIssue`.
 */
export const usePendingComposerReferences = create<PendingComposerReferences>()((set, get) => ({
    references: [],
    bySession: new Map(),
    push: (references, sessionId) => set((state) => {
        if (!sessionId) return { references: [...state.references, ...references] };
        const bySession = new Map(state.bySession);
        bySession.set(sessionId, [...(bySession.get(sessionId) ?? []), ...references]);
        return { bySession };
    }),
    consume: (sessionId) => {
        const state = get();
        const targeted = sessionId ? state.bySession.get(sessionId) ?? [] : [];
        if (sessionId && targeted.length) { const bySession = new Map(state.bySession); bySession.delete(sessionId); set({ bySession }); }
        const references = [...state.references, ...targeted];
        if (references.length > 0) set({ references: [] });
        return references;
    },
}));
