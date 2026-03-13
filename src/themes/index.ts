import { BLUE_THEME } from "./blueTheme";
import { PINK_THEME } from "./pinkTheme";
import type { ThemeDefinition, ThemeVariant, UiColorTheme, UiThemeMode } from "./types";

const THEMES: Record<UiColorTheme, ThemeDefinition> = {
  blue: BLUE_THEME,
  pink: PINK_THEME,
};

export const getThemeVariant = (colorTheme: UiColorTheme, mode: UiThemeMode): ThemeVariant =>
  THEMES[colorTheme][mode];

