import { getHolidayThemeCatalog } from "./holidayThemes";
import type { HolidayThemeKey } from "./types";

const HOLIDAY_THEMES_VISIBLE_KEY = "linksim.dev.holidayThemesVisible";
const HOLIDAY_THEME_PREVIEW_KEY = "linksim.dev.holidayThemePreview";

type DevHolidayThemeState = {
  holidayThemesVisible: boolean;
  holidayThemePreviewKey: HolidayThemeKey | null;
};

const hasWindow = typeof window !== "undefined";
const listeners = new Set<() => void>();

let devState: DevHolidayThemeState = {
  holidayThemesVisible: false,
  holidayThemePreviewKey: null,
};

const persistState = (): void => {
  if (!hasWindow) return;
  try {
    if (devState.holidayThemesVisible) window.localStorage.setItem(HOLIDAY_THEMES_VISIBLE_KEY, "true");
    else window.localStorage.removeItem(HOLIDAY_THEMES_VISIBLE_KEY);
    if (devState.holidayThemePreviewKey) window.localStorage.setItem(HOLIDAY_THEME_PREVIEW_KEY, devState.holidayThemePreviewKey);
    else window.localStorage.removeItem(HOLIDAY_THEME_PREVIEW_KEY);
  } catch {}
};

const notifyChange = (): void => {
  for (const listener of listeners) listener();
};

const readPersistedState = (): DevHolidayThemeState => {
  if (!hasWindow) return devState;
  try {
    const holidayThemesVisible = window.localStorage.getItem(HOLIDAY_THEMES_VISIBLE_KEY) === "true";
    const preview = window.localStorage.getItem(HOLIDAY_THEME_PREVIEW_KEY);
    const holidayThemePreviewKey = preview === "easter" || preview === "pride" ? preview : null;
    return { holidayThemesVisible, holidayThemePreviewKey };
  } catch {
    return devState;
  }
};

devState = readPersistedState();

export const getDevHolidayThemeState = (): DevHolidayThemeState => {
  return devState;
};

export const subscribeDevHolidayThemeState = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setHolidayThemesVisible = (visible: boolean): void => {
  const next = { ...devState, holidayThemesVisible: visible };
  if (next.holidayThemesVisible === devState.holidayThemesVisible) return;
  devState = next;
  persistState();
  notifyChange();
};

export const setHolidayThemePreview = (holidayThemeKey: HolidayThemeKey | null): void => {
  const next = { ...devState, holidayThemePreviewKey: holidayThemeKey };
  if (next.holidayThemePreviewKey === devState.holidayThemePreviewKey) return;
  devState = next;
  persistState();
  notifyChange();
};

export const resetHolidayThemeDevState = (): void => {
  const next = { holidayThemesVisible: false, holidayThemePreviewKey: null };
  if (next.holidayThemesVisible === devState.holidayThemesVisible && next.holidayThemePreviewKey === devState.holidayThemePreviewKey) return;
  devState = next;
  persistState();
  notifyChange();
};

export const listHolidayThemeKeys = (): HolidayThemeKey[] => getHolidayThemeCatalog().map((theme) => theme.key);

export const getHolidayThemesVisible = (): boolean => getDevHolidayThemeState().holidayThemesVisible;

export const getHolidayThemePreviewKey = (): HolidayThemeKey | null => getDevHolidayThemeState().holidayThemePreviewKey;
