import { describe, expect, it } from "vitest";
import {
  computeGregorianEasterSunday,
  getActiveHolidayTheme,
  resolveEffectiveColorTheme,
  resolveEasterWindow,
  toHolidayWindowId,
} from "./holidayThemes";

const isoDay = (date: Date): string => date.toISOString().slice(0, 10);

describe("holidayThemes", () => {
  it("computes Gregorian Easter Sunday dates", () => {
    expect(isoDay(computeGregorianEasterSunday(2024))).toBe("2024-03-31");
    expect(isoDay(computeGregorianEasterSunday(2025))).toBe("2025-04-20");
    expect(isoDay(computeGregorianEasterSunday(2026))).toBe("2026-04-05");
  });

  it("resolves Easter window from Friday to Monday inclusive", () => {
    const easter2025 = resolveEasterWindow(2025);
    expect(isoDay(easter2025.startUtc)).toBe("2025-04-18");
    expect(isoDay(easter2025.endUtc)).toBe("2025-04-21");
  });

  it("activates Easter theme during the configured annual window", () => {
    const active = getActiveHolidayTheme(new Date("2026-04-06T12:00:00.000Z"));
    expect(active?.key).toBe("easter");
    expect(active?.colorTheme).toBe("yellow");
    expect(active?.windowId).toBe("easter:2026");
  });

  it("stays inactive outside the Easter window", () => {
    expect(getActiveHolidayTheme(new Date("2026-04-09T12:00:00.000Z"))).toBeNull();
    expect(getActiveHolidayTheme(new Date("2026-04-02T12:00:00.000Z"))).toBeNull();
  });

  it("returns stable window ids for per-window preference handling", () => {
    const window2027 = resolveEasterWindow(2027);
    expect(toHolidayWindowId("easter", window2027)).toBe("easter:2027");
  });

  it("forces the holiday theme when Easter is active", () => {
    const resolved = resolveEffectiveColorTheme("blue", new Date("2026-04-04T12:00:00.000Z"));
    expect(resolved.colorTheme).toBe("yellow");
    expect(resolved.isHolidayThemeForced).toBe(true);
    expect(resolved.activeHolidayTheme?.windowId).toBe("easter:2026");
  });

  it("uses preferred theme when holiday window was reverted", () => {
    const resolved = resolveEffectiveColorTheme("green", new Date("2026-04-04T12:00:00.000Z"), ["easter:2026"]);
    expect(resolved.colorTheme).toBe("green");
    expect(resolved.activeHolidayTheme?.key).toBe("easter");
    expect(resolved.isHolidayThemeForced).toBe(false);
  });
});
