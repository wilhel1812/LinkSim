import type { HolidayTheme, UiColorTheme } from "./types";

export type HolidayThemeWindow = {
  startUtc: Date;
  endUtc: Date;
};

type HolidayThemeRule = {
  key: HolidayTheme["key"];
  title: string;
  message: string;
  colorTheme: UiColorTheme;
  resolveWindow: (year: number) => HolidayThemeWindow;
};

const UTC_DAY_MS = 24 * 60 * 60 * 1000;

const startOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const addUtcDays = (date: Date, days: number): Date => new Date(startOfUtcDay(date).getTime() + days * UTC_DAY_MS);

const isWithinWindow = (date: Date, window: HolidayThemeWindow): boolean => {
  const day = startOfUtcDay(date).getTime();
  return day >= startOfUtcDay(window.startUtc).getTime() && day <= startOfUtcDay(window.endUtc).getTime();
};

export const computeGregorianEasterSunday = (year: number): Date => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
};

export const resolveEasterWindow = (year: number): HolidayThemeWindow => {
  const easterSunday = computeGregorianEasterSunday(year);
  return {
    startUtc: addUtcDays(easterSunday, -9),
    endUtc: addUtcDays(easterSunday, 1),
  };
};

export const toHolidayWindowId = (holidayKey: HolidayTheme["key"], window: HolidayThemeWindow): string => {
  const year = window.startUtc.getUTCFullYear();
  return `${holidayKey}:${year}`;
};

const HOLIDAY_THEME_RULES: HolidayThemeRule[] = [
  {
    key: "easter",
    title: "Easter Theme",
    message: "Happy Easter",
    colorTheme: "yellow",
    resolveWindow: resolveEasterWindow,
  },
];

export const getActiveHolidayTheme = (date: Date): HolidayTheme | null => {
  const year = date.getUTCFullYear();
  for (const rule of HOLIDAY_THEME_RULES) {
    for (const candidateYear of [year - 1, year, year + 1]) {
      const window = rule.resolveWindow(candidateYear);
      if (!isWithinWindow(date, window)) continue;
      return {
        key: rule.key,
        title: rule.title,
        message: rule.message,
        colorTheme: rule.colorTheme,
        windowId: toHolidayWindowId(rule.key, window),
      };
    }
  }
  return null;
};

export const resolveEffectiveColorTheme = (
  preferredColorTheme: UiColorTheme,
  date: Date,
  revertedHolidayWindows: string[] = [],
): { colorTheme: UiColorTheme; activeHolidayTheme: HolidayTheme | null; isHolidayThemeForced: boolean } => {
  const activeHolidayTheme = getActiveHolidayTheme(date);
  if (!activeHolidayTheme) {
    return { colorTheme: preferredColorTheme, activeHolidayTheme: null, isHolidayThemeForced: false };
  }
  if (revertedHolidayWindows.includes(activeHolidayTheme.windowId)) {
    return { colorTheme: preferredColorTheme, activeHolidayTheme, isHolidayThemeForced: false };
  }
  return { colorTheme: activeHolidayTheme.colorTheme, activeHolidayTheme, isHolidayThemeForced: true };
};
