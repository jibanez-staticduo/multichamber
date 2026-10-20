import type { Theme } from '@/types/theme';
import { presetThemes } from './presets';
import { withPrColors } from './prColors';
import { requireTheme } from '../definition';
import flexokiLightRaw from './flexoki-light.json';
import flexokiDarkRaw from './flexoki-dark.json';
import multichamberLightRaw from './multichamber-light.json';
import multichamberDarkRaw from './multichamber-dark.json';

const flexokiLightTheme = withPrColors(requireTheme(flexokiLightRaw));
const flexokiDarkTheme = withPrColors(requireTheme(flexokiDarkRaw));
const multichamberLightTheme = withPrColors(requireTheme(multichamberLightRaw));
const multichamberDarkTheme = withPrColors(requireTheme(multichamberDarkRaw));

export const DEFAULT_LIGHT_THEME_ID = 'multichamber-light' as const;
export const DEFAULT_DARK_THEME_ID = 'multichamber-dark' as const;

export const themes: Theme[] = [
  multichamberLightTheme,
  multichamberDarkTheme,
  flexokiLightTheme,
  flexokiDarkTheme,
  ...presetThemes.filter(
    (theme) => theme.metadata.id !== 'multichamber-light' && theme.metadata.id !== 'multichamber-dark',
  ),
];

export function getThemeById(id: string): Theme | undefined {
  // Saved legacy selections resolve to the canonical palette without rewriting preferences.
  const resolvedId =
    id === 'openchamber-light' ? 'multichamber-light' :
    id === 'openchamber-dark' ? 'multichamber-dark' :
    id === 'app-light' ? 'flexoki-light' :
    id === 'app-dark' ? 'flexoki-dark' :
    id;

  return themes.find(theme => theme.metadata.id === resolvedId);
}

export function getDefaultTheme(prefersDark: boolean): Theme {
  const variant: Theme['metadata']['variant'] = prefersDark ? 'dark' : 'light';

  const defaultId = prefersDark ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
  const defaultTheme = getThemeById(defaultId);
  if (defaultTheme && defaultTheme.metadata.variant === variant) {
    return defaultTheme;
  }

  return themes.find((theme) => theme.metadata.variant === variant) ?? themes[0] ?? flexokiLightTheme;
}
