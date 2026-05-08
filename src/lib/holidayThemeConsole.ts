import { getHolidayThemeCatalog } from "../themes/holidayThemes";
import {
  resetHolidayThemeDevState,
  setHolidayThemePreview,
  setHolidayThemesVisible,
} from "../themes/holidayThemeDev";
import type { HolidayThemeKey } from "../themes/types";

type LinkSimThemeConsole = {
  listHolidayThemes: () => Array<{ key: HolidayThemeKey; title: string; colorTheme: string }>;
  setHolidayThemesVisible: (visible: boolean) => void;
  setHolidayThemePreview: (holidayThemeKey: HolidayThemeKey | null) => void;
  reset: () => void;
};

declare global {
  interface Window {
    linksimTheme?: LinkSimThemeConsole;
  }
}

export const installHolidayThemeConsole = (): void => {
  window.linksimTheme = {
    listHolidayThemes: () => getHolidayThemeCatalog(),
    setHolidayThemesVisible,
    setHolidayThemePreview,
    reset: resetHolidayThemeDevState,
  };
};
