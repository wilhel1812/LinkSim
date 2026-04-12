// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";

const hoisted = vi.hoisted(() => {
  const fetchMe = vi.fn();
  const fetchDeepLinkStatus = vi.fn();
  const fetchCloudLibrary = vi.fn();
  const fetchPublicSimulationLibrary = vi.fn();
  const loadSimulationPreset = vi.fn();

  const state: Record<string, unknown> = {
    srtmTiles: [{ id: "tile-1" }],
    recommendAndFetchTerrainForCurrentArea: async () => {},
    importLibraryData: (payload: { simulationPresets?: Array<{ id: string; name: string; snapshot?: { sites?: unknown[] } }> }) => {
      const presets = Array.isArray(payload?.simulationPresets)
        ? payload.simulationPresets.map((preset) => ({
            id: preset.id,
            name: preset.name,
            visibility: "shared",
            snapshot: { sites: Array.isArray(preset.snapshot?.sites) ? preset.snapshot.sites : [] },
          }))
        : [];
      if (presets.length) state.simulationPresets = presets;
      return { siteCount: 0, simulationCount: presets.length };
    },
    loadSimulationPreset: (presetId: string) => loadSimulationPreset(presetId),
    setSelectedLinkId: () => {},
    setSelectedSiteId: () => {},
    selectSiteById: () => {},
    clearActiveSelection: () => {},
    setMapOverlayMode: () => {},
    updateMapViewport: () => {},
    updateSimulationPresetEntry: () => {},
    updateSiteLibraryEntry: () => {},
    selectedScenarioId: "",
    selectedLinkId: "",
    links: [],
    simulationPresets: [],
    siteLibrary: [],
    sites: [],
    selectedSiteIds: [],
    loadDemoScenario: () => {},
    initializeCloudSync: () => {},
    performCloudSyncPush: async () => {},
    setCurrentUser: () => {},
    setAuthState: () => {},
    authState: "checking",
    currentUser: null,
    isOnline: true,
    setIsOnline: () => {},
    isInitializing: false,
    showSimulationLibraryRequest: false,
    setShowSimulationLibraryRequest: () => {},
    setShowNewSimulationRequest: () => {},
    setShowSiteLibraryRequest: () => {},
    basemapProvider: "maptiler",
    basemapStylePreset: "outdoor",
  };

  const useAppStore = ((selector: (value: Record<string, unknown>) => unknown) => selector(state)) as unknown as {
    <T>(selector: (value: Record<string, unknown>) => T): T;
    getState: () => Record<string, unknown>;
  };
  useAppStore.getState = () => state;

  return {
    fetchMe,
    fetchDeepLinkStatus,
    fetchCloudLibrary,
    fetchPublicSimulationLibrary,
    loadSimulationPreset,
    state,
    useAppStore,
  };
});

vi.mock("../lib/cloudUser", () => ({
  fetchCollaboratorDirectory: vi.fn(async () => []),
  fetchDeepLinkStatus: hoisted.fetchDeepLinkStatus,
  fetchMe: hoisted.fetchMe,
  setLocalDevRole: vi.fn(async () => ({})),
}));

vi.mock("../lib/cloudLibrary", () => ({
  fetchCloudLibrary: hoisted.fetchCloudLibrary,
  fetchPublicSimulationLibrary: hoisted.fetchPublicSimulationLibrary,
  pushCloudLibrary: vi.fn(async () => {}),
}));

vi.mock("../lib/migrations", () => ({
  initializeMigrations: vi.fn(),
  runMigrations: vi.fn(async () => {}),
}));

vi.mock("../lib/deepLinkApplyGate", () => ({
  canRunDeepLinkApply: (input: { accessState: string }) =>
    input.accessState === "granted" || input.accessState === "readonly",
}));

vi.mock("../hooks/useThemeVariant", () => ({
  useThemeVariant: () => ({ theme: "light", colorTheme: "green", variant: { cssVars: {} } }),
}));

vi.mock("../store/appStore", () => ({
  useAppStore: hoisted.useAppStore,
}));

vi.mock("./MapView", () => ({ MapView: () => null }));
vi.mock("./Sidebar", () => ({ Sidebar: () => null }));
vi.mock("./UserAdminPanel", () => ({ UserAdminPanel: () => null }));
vi.mock("./SimulationLibraryPanel", () => ({ default: () => null }));
vi.mock("./WelcomeModal", () => ({ default: () => null }));
vi.mock("./OnboardingTutorialModal", () => ({ default: () => null }));
vi.mock("./LinkProfileChart", () => ({ LinkProfileChart: () => null }));
vi.mock("./PanoramaChart", () => ({ PanoramaChart: () => null }));
vi.mock("./ActionButton", () => ({ ActionButton: () => null }));
vi.mock("./InlineCloseIconButton", () => ({ InlineCloseIconButton: () => null }));
vi.mock("./ModalOverlay", () => ({ ModalOverlay: ({ children }: { children?: React.ReactNode }) => children ?? null }));
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

import { AppShell } from "./AppShell";

const waitForCondition = async (check: () => boolean, timeoutMs = 2500): Promise<void> => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("AppShell deeplink cold-load flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("React", React);
    Object.assign(hoisted.state, {
      simulationPresets: [],
      selectedScenarioId: "",
      selectedSiteIds: [],
      selectedLinkId: "",
      sites: [],
      links: [],
      currentUser: null,
      authState: "checking",
      isInitializing: false,
      showSimulationLibraryRequest: false,
    });

    hoisted.fetchMe.mockResolvedValue({
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
    });
    hoisted.fetchDeepLinkStatus.mockResolvedValue({
      status: "ok",
      simulationId: "sim-mmtk88wx-2didtk",
      authenticated: true,
    });
    hoisted.fetchCloudLibrary.mockResolvedValue({
      siteLibrary: [],
      simulationPresets: [
        {
          id: "sim-mmtk88wx-2didtk",
          name: "Høgevarde hyttefelt",
          visibility: "shared",
          snapshot: { sites: [] },
        },
      ],
    });
    hoisted.fetchPublicSimulationLibrary.mockResolvedValue({
      simulationId: "sim-mmtk88wx-2didtk",
      siteLibrary: [],
      simulationPresets: [],
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

    window.history.replaceState(null, "", "/H%C3%B8gevarde-hyttefelt/Fyrisj%C3%B8vegen");
  });

  it("loads the resolved simulation id and does not emit unavailable", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(React.createElement(AppShell));

    await waitForCondition(() => hoisted.loadSimulationPreset.mock.calls.length > 0);
    expect(hoisted.loadSimulationPreset).toHaveBeenCalledWith("sim-mmtk88wx-2didtk");

    const notifications = (
      window as Window & { linksimNotifications?: { list: () => Array<{ id: string }> } }
    ).linksimNotifications?.list?.() ?? [];
    expect(notifications.some((entry) => entry.id === "shared-simulation-unavailable")).toBe(false);

    root.unmount();
    host.remove();
  });
});
