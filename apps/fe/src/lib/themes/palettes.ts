import { ThemePalette } from './types';

/*
  Theme identity only. The colour values live in `src/styles/themes.css`, keyed by the
  same names, and reach the app as CSS custom properties — a theme switch is one
  attribute on <html>, not forty inline style writes.

  Anything that needs a theme's colour outside a stylesheet should write `var(--token)`
  into the markup it builds (see `lib/markerStyles.ts`) rather than resolving the value
  in JavaScript or re-importing it here: a resolved value freezes whichever theme was
  active at the time, a `var()` follows the theme on its own.
*/
export const themes: Record<string, ThemePalette> = {
  morningCoffee: { name: 'morningCoffee', displayName: 'Morning Coffee' },
  espresso: { name: 'espresso', displayName: 'Espresso' },
  matchaLatte: { name: 'matchaLatte', displayName: 'Matcha Latte' },
  vanillaLatte: { name: 'vanillaLatte', displayName: 'Vanilla Latte' },
};

export const defaultThemeName = 'morningCoffee';
export const themeNames = Object.keys(themes);
