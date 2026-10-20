import { expect, test } from 'bun:test';
import { getCodexEngineState } from './codexSessionMetadata';
import type { Session } from './opencode/model';
const session: Session = { id: 'ses_cdx123', projectID: 'p', directory: '/repo', title: '', cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, updated: 1 }, metadata: { backend: 'codex', codex: { model: 'sol', effort: 'high', mode: 'workspace-write', contextWindow: 100000 } } };
test('restores Codex selection and context from the authoritative resumed session', () => {
  expect(getCodexEngineState(session)).toEqual({ model: 'sol', effort: 'high', mode: 'workspace-write', contextWindow: 100000 });
  expect(getCodexEngineState({ ...session, metadata: { codex: { mode: 123 } } })).toEqual({});
  expect(getCodexEngineState(null)).toEqual({});
});
