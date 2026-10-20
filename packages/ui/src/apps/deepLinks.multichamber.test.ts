import { expect, test } from 'bun:test';
import { parseDeepLink } from './deepLinks';

test('new application links use Multichamber while existing saved links still resolve', () => {
  const intent = { type: 'session', sessionId: 'ses_cdxexample', directory: '/repo' } as const;
  expect(parseDeepLink('multichamber://session/ses_cdxexample?dir=%2Frepo')).toMatchObject(intent);
  expect(parseDeepLink('openchamber://session/ses_cdxexample?dir=%2Frepo')).toMatchObject(intent);
  expect(parseDeepLink('otherapp://session/ses_cdxexample')).toBeNull();
});
