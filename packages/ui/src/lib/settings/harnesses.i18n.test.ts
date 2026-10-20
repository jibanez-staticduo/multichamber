import { expect, test } from 'bun:test';
import { LOCALES } from '@/lib/i18n/runtime';
import type { I18nKey } from '@/lib/i18n';
import { dict as english } from '@/lib/i18n/messages/en';

test('all engine settings and creation messages are translated in every locale', async () => {
  // SAFETY: Object.keys lists only this dictionary's declared translation keys.
  const keys = (Object.keys(english) as I18nKey[]).filter((key) => key.startsWith('settings.harnesses.') || key.startsWith('sessions.creation.'));
  for (const locale of LOCALES) {
    const { dict } = await import(`../i18n/messages/${locale}.ts`);
    for (const key of keys) {
      expect(dict[key]).toBeTruthy();
      if (locale !== 'en') expect(dict[key]).not.toBe(english[key]);
    }
  }
});
