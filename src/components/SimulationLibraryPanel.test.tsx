// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, String(value)),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() { return data.size; },
  });
});

import { useAppStore } from "../store/appStore";
import SimulationLibraryPanel from "./SimulationLibraryPanel";

describe("SimulationLibraryPanel profiles", () => {
  beforeEach(() => {
    localStorage.clear();
    useAppStore.setState(useAppStore.getInitialState(), true);
    useAppStore.setState({
      currentUser: {
        id: "owner-1",
        username: "Owner User",
        bio: "",
        avatarUrl: "",
        isAdmin: false,
        isApproved: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: null,
      },
      simulationPresets: [
        {
          id: "sim-1",
          name: "Ridge Plan",
          visibility: "shared",
          sharedWith: [],
          ownerUserId: "owner-1",
          createdByName: "Owner User",
          createdByAvatarUrl: "",
          effectiveRole: "viewer",
          updatedAt: "2026-01-02T00:00:00.000Z",
          snapshot: {
            sites: [],
            links: [],
            systems: [],
            networks: [],
            selectedSiteId: "",
            selectedLinkId: "",
            selectedNetworkId: "",
            selectedCoverageResolution: "24",
            propagationModel: "ITM",
            selectedFrequencyPresetId: "custom",
            rxSensitivityTargetDbm: -120,
            environmentLossDb: 0,
            propagationEnvironment: useAppStore.getState().propagationEnvironment,
            autoPropagationEnvironment: true,
            terrainDataset: "copernicus30",
          },
        },
      ],
    });
  });

  it("opens the owner profile separately from loading the Simulation", async () => {
    const onLoadSimulation = vi.fn();
    const onOpenUserProfile = vi.fn();
    render(
      <SimulationLibraryPanel
        onClose={vi.fn()}
        onLoadSimulation={onLoadSimulation}
        onOpenUserProfile={onOpenUserProfile}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Open owner profile: Owner User" }));
    expect(onOpenUserProfile).toHaveBeenCalledWith("owner-1", expect.any(HTMLElement));
    expect(onLoadSimulation).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Load" }));
    expect(onLoadSimulation).toHaveBeenCalledWith("sim-1");
  });
});
