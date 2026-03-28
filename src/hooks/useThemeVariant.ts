import { useMemo } from "react";
import { getThemeVariant } from "../themes";
import { resolveEffectiveColorTheme } from "../themes/holidayThemes";
import { useUiTheme } from "./useUiTheme";
import { useAppStore } from "../store/appStore";

export const useThemeVariant = () => {
  const ui = useUiTheme();
  const holidayWindowState = useAppStore((s) => s.holidayWindowState);
  const revertHolidayThemeForWindow = useAppStore((s) => s.revertHolidayThemeForWindow);
  const dismissHolidayThemeNotice = useAppStore((s) => s.dismissHolidayThemeNotice);

  const { colorTheme, activeHolidayTheme, isHolidayThemeForced } = useMemo(
    () => resolveEffectiveColorTheme(ui.colorTheme, new Date(), holidayWindowState.reverted),
    [ui.colorTheme, holidayWindowState.reverted],
  );
  const holidayWindowId = activeHolidayTheme?.windowId ?? null;
  const isHolidayThemeNoticeDismissed = holidayWindowId
    ? holidayWindowState.dismissed.includes(holidayWindowId)
    : false;
  const variant = useMemo(() => getThemeVariant(colorTheme, ui.theme), [colorTheme, ui.theme]);

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
