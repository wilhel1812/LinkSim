import { beforeEach, describe, expect, it } from "vitest";
import {
  getDevHolidayThemeState,
  resetHolidayThemeDevState,
  setHolidayThemePreview,
  setHolidayThemesVisible,
} from "./holidayThemeDev";

describe("holidayThemeDev", () => {
  beforeEach(() => {
    resetHolidayThemeDevState();
  });

  it("defaults to hidden themes and no preview", () => {
    expect(getDevHolidayThemeState()).toEqual({ holidayThemesVisible: false, holidayThemePreviewKey: null });
  });

  it("persists visibility and preview state", () => {
    setHolidayThemesVisible(true);
    setHolidayThemePreview("pride");
    expect(getDevHolidayThemeState()).toEqual({ holidayThemesVisible: true, holidayThemePreviewKey: "pride" });
  });

  it("resets visibility and preview state", () => {
    setHolidayThemesVisible(true);
    setHolidayThemePreview("easter");
    resetHolidayThemeDevState();
    expect(getDevHolidayThemeState()).toEqual({ holidayThemesVisible: false, holidayThemePreviewKey: null });
  });
});
