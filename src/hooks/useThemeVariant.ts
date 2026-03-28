import { useCallback, useMemo, useState } from "react";
import { getThemeVariant } from "../themes";
import { resolveEffectiveColorTheme } from "../themes/holidayThemes";
import { useUiTheme } from "./useUiTheme";

const HOLIDAY_THEME_REVERT_KEY = "linksim-holiday-theme-revert-v1";
const HOLIDAY_THEME_NOTICE_DISMISS_KEY = "linksim-holiday-theme-notice-dismiss-v1";

type HolidayWindowState = {
  reverted: string[];
  dismissed: string[];
};

const readHolidayWindowState = (): HolidayWindowState => {
  const fallback: HolidayWindowState = { reverted: [], dismissed: [] };
  if (typeof window === "undefined") return fallback;
  try {
    const reverted = JSON.parse(window.localStorage.getItem(HOLIDAY_THEME_REVERT_KEY) ?? "[]");
    const dismissed = JSON.parse(window.localStorage.getItem(HOLIDAY_THEME_NOTICE_DISMISS_KEY) ?? "[]");
    return {
      reverted: Array.isArray(reverted) ? reverted.filter((value): value is string => typeof value === "string") : [],
      dismissed: Array.isArray(dismissed) ? dismissed.filter((value): value is string => typeof value === "string") : [],
    };
  } catch {
    return fallback;
  }
};

const appendUniqueWindowId = (ids: string[], nextId: string): string[] => (ids.includes(nextId) ? ids : [...ids, nextId]);

const writeHolidayWindowState = (state: HolidayWindowState) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(HOLIDAY_THEME_REVERT_KEY, JSON.stringify(state.reverted));
  window.localStorage.setItem(HOLIDAY_THEME_NOTICE_DISMISS_KEY, JSON.stringify(state.dismissed));
};

export const useThemeVariant = () => {
  const ui = useUiTheme();
  const [holidayWindowState, setHolidayWindowState] = useState<HolidayWindowState>(() => readHolidayWindowState());
  const { colorTheme, activeHolidayTheme, isHolidayThemeForced } = useMemo(
    () => resolveEffectiveColorTheme(ui.colorTheme, new Date(), holidayWindowState.reverted),
    [ui.colorTheme, holidayWindowState.reverted],
  );
  const holidayWindowId = activeHolidayTheme?.windowId ?? null;

  const isHolidayThemeNoticeDismissed = holidayWindowId
    ? holidayWindowState.dismissed.includes(holidayWindowId)
    : false;
  const variant = useMemo(() => getThemeVariant(colorTheme, ui.theme), [colorTheme, ui.theme]);

  const dismissHolidayThemeNotice = useCallback(() => {
    if (!holidayWindowId) return;
    setHolidayWindowState((current) => {
      const next: HolidayWindowState = {
        reverted: current.reverted,
        dismissed: appendUniqueWindowId(current.dismissed, holidayWindowId),
      };
      writeHolidayWindowState(next);
      return next;
    });
  }, [holidayWindowId]);

  const revertHolidayThemeForWindow = useCallback(() => {
    if (!holidayWindowId) return;
    setHolidayWindowState((current) => {
      const next: HolidayWindowState = {
        reverted: appendUniqueWindowId(current.reverted, holidayWindowId),
        dismissed: appendUniqueWindowId(current.dismissed, holidayWindowId),
      };
      writeHolidayWindowState(next);
      return next;
    });
  }, [holidayWindowId]);

  return {
    ...ui,
    colorTheme,
    variant,
    activeHolidayTheme,
    showHolidayThemeNotice: Boolean(activeHolidayTheme && !isHolidayThemeNoticeDismissed),
    isHolidayThemeForced,
    dismissHolidayThemeNotice,
    revertHolidayThemeForWindow,
  };
};
