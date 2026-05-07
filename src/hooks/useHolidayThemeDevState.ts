import { useSyncExternalStore } from "react";
import { getDevHolidayThemeState, subscribeDevHolidayThemeState } from "../themes/holidayThemeDev";

export const useHolidayThemeDevState = () =>
  useSyncExternalStore(subscribeDevHolidayThemeState, getDevHolidayThemeState, getDevHolidayThemeState);
