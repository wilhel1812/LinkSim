// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { simulationDefaultsFromPreset, type UserSimulationDefaultsPreference } from "../../../lib/simulationDefaults";
import type { CloudUser } from "../../../lib/cloudUser";
import { parseRadioPresetShareHash } from "../../../lib/radioPresetShare";

const hoisted = vi.hoisted(() => ({
  updateMyProfile: vi.fn(),
  setCurrentUser: vi.fn(),
  setAuthState: vi.fn(),
  clipboardWriteText: vi.fn(),
  store: {
    uiThemePreference: "system",
    setUiThemePreference: vi.fn(),
    uiColorTheme: "blue",
    setUiColorTheme: vi.fn(),
    setCurrentUser: vi.fn(),
    setAuthState: vi.fn(),
  } as Record<string, unknown>,
}));

vi.mock("../../../lib/cloudUser", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../lib/cloudUser")>();
  return { ...original, updateMyProfile: hoisted.updateMyProfile };
});

vi.mock("../../../store/appStore", () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(hoisted.store),
}));

vi.mock("../../../hooks/useThemeVariant", () => ({
  useThemeVariant: () => ({ activeHolidayTheme: null, holidayThemesVisible: false }),
}));

import { PreferencesSection } from "./PreferencesSection";

const userWithPreference = (preference: UserSimulationDefaultsPreference): CloudUser => ({
  id: "user-1",
  username: "Owner",
  bio: "",
  avatarUrl: "",
  isAdmin: false,
  isApproved: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  defaultFrequencyPresetId: preference.presetId,
  simulationDefaultsPreference: preference,
});

describe("PreferencesSection custom radio presets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: hoisted.clipboardWriteText },
    });
    hoisted.clipboardWriteText.mockResolvedValue(undefined);
  });

  it("shows the migrated legacy custom preset and blocks deleting the active default", async () => {
    const me = userWithPreference({
      mode: "custom",
      presetId: "mt-us",
      overridePresetDefaults: false,
      custom: { ...simulationDefaultsFromPreset("mt-us"), frequencyMHz: 906.875 },
    });
    render(<PreferencesSection me={me} onMeUpdated={vi.fn()} />);

    expect((await screen.findAllByRole("option", { name: "My custom preset" })).length).toBe(2);
    expect(screen.getByRole("button", { name: "Delete custom preset: My custom preset" })).toBeDisabled();
  });

  it("copies a saved preset as a valid self-contained fragment", async () => {
    const defaults = { ...simulationDefaultsFromPreset("mt-eu_868"), frequencyPresetId: "radio-alpine", frequencyMHz: 869.4 };
    const me = userWithPreference({
      mode: "custom",
      presetId: "mt-eu_868",
      customPresetId: "radio-alpine",
      customPresets: [{ id: "radio-alpine", name: "Alpine Mesh", defaults }],
      overridePresetDefaults: false,
    });
    render(<PreferencesSection me={me} onMeUpdated={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Share custom preset: Alpine Mesh" }));

    await waitFor(() => expect(hoisted.clipboardWriteText).toHaveBeenCalledTimes(1));
    const url = new URL(String(hoisted.clipboardWriteText.mock.calls[0]?.[0]));
    expect(parseRadioPresetShareHash(url.hash)).toMatchObject({
      ok: true,
      preset: { name: "Alpine Mesh", defaults: { frequencyMHz: 869.4 } },
    });
  });

  it("creates a uniquely named preset without changing the active default", async () => {
    const me = userWithPreference({ mode: "preset", presetId: "mt-us", overridePresetDefaults: false });
    hoisted.updateMyProfile.mockImplementation(async (patch: { simulationDefaultsPreference: UserSimulationDefaultsPreference }) => ({
      ...me,
      simulationDefaultsPreference: patch.simulationDefaultsPreference,
    }));
    render(<PreferencesSection me={me} onMeUpdated={vi.fn()} />);

    await userEvent.type(screen.getByRole("textbox", { name: "New custom preset name" }), "Field Mesh");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(hoisted.updateMyProfile).toHaveBeenCalledTimes(1));
    const patch = hoisted.updateMyProfile.mock.calls[0]?.[0];
    expect(patch.simulationDefaultsPreference).toMatchObject({
      mode: "preset",
      presetId: "mt-us",
      customPresets: [expect.objectContaining({ name: "Field Mesh" })],
    });
  });
});
