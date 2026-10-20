import { expect, test } from 'bun:test';
import { nativeSessionLabel } from './nativeSessionLabel';

const child = { id: 'ses_cdxchild', parentID: 'ses_cdxparent', title: 'Untitled session', metadata: { backend: 'codex', codex: { agentNickname: 'Checker', agentPath: '/root/review', agentRole: 'reviewer' } } };
test('preserves authoritative titles and root-session names', () => {
  expect(nativeSessionLabel({ ...child, title: 'Check the migration' }, 'Untitled')).toBe('Check the migration');
  expect(nativeSessionLabel({ ...child, parentID: undefined }, 'Untitled')).toBe('Untitled session');
});
test('uses native identity only for untitled Codex children and distinguishes equal nicknames', () => {
  expect(nativeSessionLabel(child, 'Untitled')).toBe('Checker (/root/review)');
  expect(nativeSessionLabel({ ...child, metadata: { backend: 'codex', codex: { agentNickname: 'Checker', agentPath: '/root/tests' } } }, 'Untitled')).toBe('Checker (/root/tests)');
  expect(nativeSessionLabel({ ...child, title: '', metadata: { backend: 'codex', codex: { agentRole: 'reviewer' } } }, 'Untitled')).toBe('reviewer');
  expect(nativeSessionLabel({ ...child, metadata: { backend: 'claude' } }, 'Untitled')).toBe('Untitled session');
});
