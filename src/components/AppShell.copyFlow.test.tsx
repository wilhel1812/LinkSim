// @vitest-environment jsdom
import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "../store/appStore";

vi.hoisted(() => {
  const values = new Map<string, string>();
  const localStorageMock = {
    get length() {
      return values.size;
    },
    clear: vi.fn(() => values.clear()),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(values.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, String(value));
    }),
  };
  vi.stubGlobal("localStorage", localStorageMock);
});
const { pushCloudLibraryMock } = vi.hoisted(() => ({
  pushCloudLibraryMock: vi.fn(async () => {}),
}));

const sidebarCalls: Array<{ readOnly?: boolean; panelToggleControl?: unknown }> = [];

vi.mock("../lib/cloudUser", () => ({
  fetchAuthStatus: vi.fn(async () => ({ authenticated: true, authState: "authenticated" })),
  fetchCollaboratorDirectory: vi.fn(async () => []),
  fetchDeepLinkStatus: vi.fn(async () => ({ status: "ok", simulationId: null, authenticated: true })),
  fetchMe: vi.fn(async () => ({
    id: "user-1",
    username: "Owner",
    isAdmin: false,
    isModerator: false,
    isApproved: true,
    accountState: "approved",
    avatarUrl: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    bio: "",
  })),
  setLocalDevRole: vi.fn(async () => ({})),
}));

vi.mock("../lib/cloudLibrary", () => ({
  fetchCloudLibrary: vi.fn(async () => ({ siteLibrary: [], simulationPresets: [] })),
  fetchPublicSimulationLibrary: vi.fn(async () => ({ simulationId: null, siteLibrary: [], simulationPresets: [] })),
  pushCloudLibrary: pushCloudLibraryMock,
}));

vi.mock("../lib/environment", () => ({ getCurrentRuntimeEnvironment: () => "production" }));
vi.mock("../hooks/useThemeVariant", () => ({ useThemeVariant: () => ({ theme: "light", colorTheme: "green", variant: { cssVars: {} } }) }));
vi.mock("../lib/migrations", () => ({ initializeMigrations: vi.fn(), runMigrations: vi.fn(async () => {}) }));
vi.mock("./MapView", () => ({
  MapView: ({ inspectorActions }: { inspectorActions?: React.ReactNode }) => <div>{inspectorActions}</div>,
}));
vi.mock("./UserAdminPanel", () => ({ UserAdminPanel: () => null }));
vi.mock("./SimulationLibraryPanel", () => ({ default: () => null }));
vi.mock("./WelcomeModal", () => ({ default: () => null }));
vi.mock("./OnboardingTutorialModal", () => ({ default: () => null }));
vi.mock("./LinkProfileChart", () => ({ LinkProfileChart: () => null }));
vi.mock("./PanoramaChart", () => ({ PanoramaChart: () => null }));
vi.mock("./ActionButton", () => ({
  ActionButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));
vi.mock("./InlineCloseIconButton", () => ({ InlineCloseIconButton: () => null }));
vi.mock("./ModalOverlay", () => ({ ModalOverlay: ({ children }: { children?: React.ReactNode }) => <>{children}</> }));
vi.mock("./app-shell/MobileWorkspaceTabs", () => ({ MobileWorkspaceTabs: () => null }));
vi.mock("./app-shell/useOnboardingFlow", () => ({
  useOnboardingFlow: () => ({
    showWelcomeModal: false,
    setShowWelcomeModal: vi.fn(),
    showOnboardingTutorial: false,
    setShowOnboardingTutorial: vi.fn(),
    closeWelcome: vi.fn(),
    openOnboardingTutorial: vi.fn(),
    openWelcomeFromWelcome: vi.fn(),
    openLibraryFromWelcome: vi.fn(),
    createNewFromWelcome: vi.fn(),
  }),
}));

vi.mock("./Sidebar", () => ({
  Sidebar: (props: { readOnly?: boolean; panelToggleControl?: unknown }) => {
    sidebarCalls.push(props);
    return null;
  },
}));

import { AppShell } from "./AppShell";

describe("AppShell copy flow", () => {
  beforeEach(() => {
    sidebarCalls.length = 0;
    window.history.replaceState(null, "", "/");
    localStorage.clear();
    pushCloudLibraryMock.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => {}) },
    });
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "(max-width: 980px)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    useAppStore.setState((state) => ({
      ...state,
      currentUser: null,
      authState: "checking",
      selectedScenarioId: "sim-shared",
      selectedSiteId: "site-alpha",
      selectedSiteIds: ["site-alpha"],
      selectedLinkId: "link-alpha",
      sites: [
        {
          id: "site-alpha",
          name: "Site Alpha",
          position: { lat: 60.5, lon: 11.5 },
          groundElevationM: 120,
          antennaHeightM: 2,
          txPowerDbm: 20,
          txGainDbi: 2,
          rxGainDbi: 2,
          cableLossDb: 1,
        },
        {
          id: "site-beta",
          name: "Site Beta",
          position: { lat: 60.6, lon: 11.6 },
          groundElevationM: 130,
          antennaHeightM: 4,
          txPowerDbm: 21,
          txGainDbi: 3,
          rxGainDbi: 3,
          cableLossDb: 1,
        },
      ],
      links: [
        {
          id: "link-alpha",
          name: "Alpha Link",
          fromSiteId: "site-alpha",
          toSiteId: "site-beta",
          frequencyMHz: 868,
        },
      ],
      simulationPresets: [
        {
          id: "sim-shared",
          name: "Shared Sim",
          ownerUserId: "other-user",
          createdByName: "Other",
          visibility: "shared",
          effectiveRole: "viewer",
          sharedWith: [],
          updatedAt: "2026-01-01T00:00:00.000Z",
          snapshot: {
            sites: [
              {
                id: "site-alpha",
                name: "Site Alpha",
                position: { lat: 60.5, lon: 11.5 },
                groundElevationM: 120,
                antennaHeightM: 2,
                txPowerDbm: 20,
                txGainDbi: 2,
                rxGainDbi: 2,
                cableLossDb: 1,
              },
              {
                id: "site-beta",
                name: "Site Beta",
                position: { lat: 60.6, lon: 11.6 },
                groundElevationM: 130,
                antennaHeightM: 4,
                txPowerDbm: 21,
                txGainDbi: 3,
                rxGainDbi: 3,
                cableLossDb: 1,
              },
            ],
            links: [
              {
                id: "link-alpha",
                name: "Alpha Link",
                fromSiteId: "site-alpha",
                toSiteId: "site-beta",
                frequencyMHz: 868,
              },
            ],
            systems: [],
            networks: [],
            selectedSiteId: "site-alpha",
            selectedLinkId: "link-alpha",
            selectedNetworkId: "",
            selectedCoverageResolution: "24",
            propagationModel: "ITM",
            selectedFrequencyPresetId: "custom",
            rxSensitivityTargetDbm: -120,
            environmentLossDb: 0,
            propagationEnvironment: state.propagationEnvironment,
            autoPropagationEnvironment: true,
            terrainDataset: "copernicus30",
          },
        },
      ],
    }));
  });

  it("rerenders the sidebar as writable after loading a copied simulation", async () => {
    const view = render(<AppShell />);

    try {
      await waitFor(() => expect(sidebarCalls.length).toBeGreaterThan(0));
      expect(sidebarCalls[sidebarCalls.length - 1]?.readOnly).toBe(true);

      const createdId = useAppStore.getState().createSimulationCopyFromCurrent("Shared Sim Copy", {
        description: "Copied for debugging",
      });
      expect(createdId).toBeTruthy();

      await act(async () => {
        useAppStore.getState().loadSimulationPreset(createdId as string);
      });

      await waitFor(() => expect(sidebarCalls[sidebarCalls.length - 1]?.readOnly).toBe(false));
      expect(useAppStore.getState().selectedScenarioId).toBe(createdId);
      expect(useAppStore.getState().sites).toHaveLength(2);
      expect(useAppStore.getState().links).toHaveLength(1);
    } finally {
      view.unmount();
    }
  });

  it("keeps the workspace writable after creating and loading a blank simulation", async () => {
    const view = render(<AppShell />);

    try {
      await waitFor(() => expect(sidebarCalls.length).toBeGreaterThan(0));

      const createdId = useAppStore.getState().createBlankSimulationPreset("Blank Simulation", {
        visibility: "private",
        ownerUserId: "user-1",
      });
      expect(createdId).toBeTruthy();

      await act(async () => {
        useAppStore.getState().loadSimulationPreset(createdId as string);
      });

      await waitFor(() => expect(sidebarCalls[sidebarCalls.length - 1]?.readOnly).toBe(false));
      expect(useAppStore.getState().selectedScenarioId).toBe(createdId);
    } finally {
      view.unmount();
    }
  });

  it("shares a Simulation without changing referenced Private Site visibility", async () => {
    const state = useAppStore.getState();
    const privateSite = {
      id: "private-site",
      name: "Private Site",
      visibility: "private" as const,
      ownerUserId: "user-1",
      effectiveRole: "owner" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      position: { lat: 60.5, lon: 11.5 },
      groundElevationM: 120,
      antennaHeightM: 2,
      txPowerDbm: 20,
      txGainDbi: 2,
      rxGainDbi: 2,
      cableLossDb: 1,
    };
    useAppStore.setState({
      siteLibrary: [privateSite],
      sites: state.sites.map((site, index) =>
        index === 0 ? { ...site, libraryEntryId: privateSite.id } : site,
      ),
      simulationPresets: state.simulationPresets.map((simulation) => ({
        ...simulation,
        ownerUserId: "user-1",
        effectiveRole: "owner",
        visibility: "private",
        snapshot: {
          ...simulation.snapshot,
          sites: simulation.snapshot.sites.map((site, index) =>
            index === 0 ? { ...site, libraryEntryId: privateSite.id } : site,
          ),
        },
      })),
    });

    const view = render(<AppShell />);
    try {
      await userEvent.click(await screen.findByRole("button", { name: "Share" }));
      await userEvent.click(await screen.findByRole("button", { name: "Make Shared & Copy Link" }));

      await waitFor(() => expect(pushCloudLibraryMock).toHaveBeenCalledTimes(1));
      expect(useAppStore.getState().simulationPresets[0]?.visibility).toBe("shared");
      expect(useAppStore.getState().siteLibrary[0]?.visibility).toBe("private");
      expect(pushCloudLibraryMock).toHaveBeenCalledWith(expect.objectContaining({
        siteLibrary: [],
        simulationPresets: [expect.objectContaining({ visibility: "shared" })],
      }));
    } finally {
      view.unmount();
    }
  });
});
