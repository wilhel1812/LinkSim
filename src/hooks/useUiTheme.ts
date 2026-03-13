import { useAppStore } from "../store/appStore";
import type { UiColorTheme } from "../themes/types";
import { type SystemTheme, useSystemTheme } from "./useSystemTheme";

export type UiThemePreference = "system" | "light" | "dark";
export type UiThemeResolved = "light" | "dark";

const resolveTheme = (preference: UiThemePreference, systemTheme: SystemTheme): UiThemeResolved =>
  preference === "system" ? systemTheme : preference;

export const useUiTheme = () => {
  const preference = useAppStore((state) => state.uiThemePreference);
  const setPreference = useAppStore((state) => state.setUiThemePreference);
  const colorTheme = useAppStore((state) => state.uiColorTheme) as UiColorTheme;
  const setColorTheme = useAppStore((state) => state.setUiColorTheme);
  const systemTheme = useSystemTheme();
  const theme = resolveTheme(preference, systemTheme);
  return { theme, systemTheme, preference, setPreference, colorTheme, setColorTheme };
};
