import { BLUE_THEME } from "./blueTheme";
import { GREEN_THEME } from "./greenTheme";
import { NEUTRAL_THEME } from "./neutralTheme";
import { PINK_THEME } from "./pinkTheme";
import { RED_THEME } from "./redTheme";
import { YELLOW_THEME } from "./yellowTheme";
import type { ThemeDefinition, ThemeVariant, UiColorTheme, UiThemeMode } from "./types";

export const THEMES: Record<UiColorTheme, ThemeDefinition> = {
  blue: BLUE_THEME,
  pink: PINK_THEME,
  red: RED_THEME,
  green: GREEN_THEME,
  yellow: YELLOW_THEME,
  neutral: NEUTRAL_THEME,
};

export const getThemeVariant = (colorTheme: UiColorTheme, mode: UiThemeMode): ThemeVariant =>
  THEMES[colorTheme][mode];
