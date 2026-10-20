import { expect, test } from 'bun:test';
import { usePendingComposerReferences } from './pendingComposerReferences';
import type { ComposerReference } from './composerReferences';

test('a new native session attachment cannot be consumed by the previous composer', () => {
  const store = usePendingComposerReferences.getState();
  const reference: ComposerReference = { kind: 'linear-issue', identifier: 'QA-1', contextText: 'Synthetic QA issue', title: 'Synthetic QA', url: 'https://example.test/QA-1' };
  store.push([reference], 'ses_cdxnew');
  expect(store.consume('old-session')).toEqual([]);
  expect(store.consume('ses_cdxnew')).toEqual([reference]);
  expect(store.consume('ses_cdxnew')).toEqual([]);
});
