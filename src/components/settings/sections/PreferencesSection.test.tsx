// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    basemapStyleId: "street-linksim",
    setBasemapStyleId: vi.fn(),
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

  afterEach(() => {
    vi.useRealTimers();
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

  it("keeps multi-character value edits optimistic and debounces the final draft", async () => {
    vi.useFakeTimers();
    const defaults = { ...simulationDefaultsFromPreset("mt-eu_868"), frequencyPresetId: "radio-alpine" };
    const me = userWithPreference({
      mode: "custom",
      presetId: "mt-eu_868",
      customPresetId: "radio-alpine",
      customPresets: [{ id: "radio-alpine", name: "Alpine Mesh", defaults }],
      overridePresetDefaults: false,
    });
    hoisted.updateMyProfile.mockImplementation(() => new Promise(() => {}));
    render(<PreferencesSection me={me} onMeUpdated={vi.fn()} />);

    const frequency = screen.getByRole("spinbutton", { name: "Frequency (MHz)" });
    fireEvent.change(frequency, { target: { value: "9" } });
    fireEvent.change(frequency, { target: { value: "91" } });
    fireEvent.change(frequency, { target: { value: "915" } });

    expect(frequency).toHaveValue(915);
    expect(hoisted.updateMyProfile).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Share custom preset: Alpine Mesh" })).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    expect(hoisted.updateMyProfile).toHaveBeenCalledTimes(1);
    expect(hoisted.updateMyProfile.mock.calls[0]?.[0].simulationDefaultsPreference.customPresets[0].defaults.frequencyMHz).toBe(915);
    vi.useRealTimers();
  });

  it("serializes overlapping saves and sends the newest complete draft", async () => {
    vi.useFakeTimers();
    const defaults = { ...simulationDefaultsFromPreset("mt-eu_868"), frequencyPresetId: "radio-alpine" };
    const me = userWithPreference({
      mode: "custom",
      presetId: "mt-eu_868",
      customPresetId: "radio-alpine",
      customPresets: [{ id: "radio-alpine", name: "Alpine Mesh", defaults }],
      overridePresetDefaults: false,
    });
    const resolvers: Array<(user: CloudUser) => void> = [];
    hoisted.updateMyProfile.mockImplementation(() => new Promise<CloudUser>((resolve) => resolvers.push(resolve)));
    render(<PreferencesSection me={me} onMeUpdated={vi.fn()} />);

    const frequency = screen.getByRole("spinbutton", { name: "Frequency (MHz)" });
    const bandwidth = screen.getByRole("spinbutton", { name: "Bandwidth (kHz)" });
    fireEvent.change(frequency, { target: { value: "915" } });
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); });
    expect(hoisted.updateMyProfile).toHaveBeenCalledTimes(1);

    fireEvent.change(bandwidth, { target: { value: "125" } });
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); });
    expect(hoisted.updateMyProfile).toHaveBeenCalledTimes(1);
    expect(frequency).toHaveValue(915);
    expect(bandwidth).toHaveValue(125);

    const firstPatch = hoisted.updateMyProfile.mock.calls[0]?.[0];
    await act(async () => {
      resolvers[0]?.({ ...me, simulationDefaultsPreference: firstPatch.simulationDefaultsPreference });
      await Promise.resolve();
    });
    expect(hoisted.updateMyProfile).toHaveBeenCalledTimes(2);
    const secondDefaults = hoisted.updateMyProfile.mock.calls[1]?.[0].simulationDefaultsPreference.customPresets[0].defaults;
    expect(secondDefaults).toMatchObject({ frequencyMHz: 915, bandwidthKhz: 125 });
    expect(frequency).toHaveValue(915);
    expect(bandwidth).toHaveValue(125);
    vi.useRealTimers();
  });

  it("retains the optimistic draft and disables sharing after a save failure", async () => {
    vi.useFakeTimers();
    const defaults = { ...simulationDefaultsFromPreset("mt-eu_868"), frequencyPresetId: "radio-alpine" };
    const me = userWithPreference({
      mode: "custom",
      presetId: "mt-eu_868",
      customPresetId: "radio-alpine",
      customPresets: [{ id: "radio-alpine", name: "Alpine Mesh", defaults }],
      overridePresetDefaults: false,
    });
    hoisted.updateMyProfile.mockRejectedValue(new Error("Preset save failed"));
    render(<PreferencesSection me={me} onMeUpdated={vi.fn()} />);

    const frequency = screen.getByRole("spinbutton", { name: "Frequency (MHz)" });
    fireEvent.change(frequency, { target: { value: "915" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(frequency).toHaveValue(915);
    expect(screen.getAllByText("Preset save failed")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Share custom preset: Alpine Mesh" })).toBeDisabled();
    vi.useRealTimers();
  });

  it("edits and saves polarization as part of the complete manual defaults", async () => {
    vi.useFakeTimers();
    const defaults = {
      ...simulationDefaultsFromPreset("mt-eu_868"),
      frequencyPresetId: "radio-alpine",
      autoPropagationEnvironment: false,
    };
    const me = userWithPreference({
      mode: "custom",
      presetId: "mt-eu_868",
      customPresetId: "radio-alpine",
      customPresets: [{ id: "radio-alpine", name: "Alpine Mesh", defaults }],
      overridePresetDefaults: false,
    });
    hoisted.updateMyProfile.mockImplementation(async (patch: { simulationDefaultsPreference: UserSimulationDefaultsPreference }) => ({
      ...me,
      simulationDefaultsPreference: patch.simulationDefaultsPreference,
    }));
    render(<PreferencesSection me={me} onMeUpdated={vi.fn()} />);

    const polarization = screen.getByRole("combobox", { name: "Polarization" });
    fireEvent.change(polarization, { target: { value: "Horizontal" } });
    expect(polarization).toHaveValue("Horizontal");
    await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); });
    expect(hoisted.updateMyProfile.mock.calls[0]?.[0].simulationDefaultsPreference.customPresets[0].defaults.propagationEnvironment.polarization).toBe("Horizontal");
    vi.useRealTimers();
  });

  it("creates an account-synced custom MapLibre style source", async () => {
    const me = userWithPreference({ mode: "preset", presetId: "mt-us", overridePresetDefaults: false });
    hoisted.updateMyProfile.mockImplementation(async (patch) => ({ ...me, basemapPreferences: patch.basemapPreferences }));
    render(<PreferencesSection me={me} onMeUpdated={vi.fn()} />);

    await userEvent.type(screen.getByRole("textbox", { name: "Custom map name" }), "Field Map");
    await userEvent.type(screen.getByRole("textbox", { name: "Custom map light URL" }), "https://maps.test/style.json?token=browser-safe");
    await userEvent.type(screen.getByRole("textbox", { name: "Custom map attribution" }), "Field data");
    await userEvent.click(screen.getByRole("button", { name: "Create custom map" }));

    await waitFor(() => expect(hoisted.updateMyProfile).toHaveBeenCalledTimes(1));
    expect(hoisted.updateMyProfile.mock.calls[0]?.[0].basemapPreferences.customSources[0]).toMatchObject({
      name: "Field Map", kind: "style", lightUrl: "https://maps.test/style.json?token=browser-safe",
    });
  });

  it("returns the device to LinkSim when deleting its active custom source", async () => {
    const me = {
      ...userWithPreference({ mode: "preset", presetId: "mt-us", overridePresetDefaults: false }),
      basemapPreferences: { version: 1 as const, customSources: [{ id: "field", name: "Field Map", kind: "style" as const, lightUrl: "https://maps.test/style.json", attribution: "Field data" }] },
    };
    hoisted.store.basemapStyleId = "custom:field";
    hoisted.updateMyProfile.mockImplementation(async (patch) => ({ ...me, basemapPreferences: patch.basemapPreferences }));
    render(<PreferencesSection me={me} onMeUpdated={vi.fn()} />);

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Custom maps/ }), "field");
    await userEvent.click(screen.getByRole("button", { name: "Delete custom map: Field Map" }));

    await waitFor(() => expect(hoisted.store.setBasemapStyleId).toHaveBeenCalledWith("street-linksim"));
  });
});
