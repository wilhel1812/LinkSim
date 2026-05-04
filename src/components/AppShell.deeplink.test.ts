// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

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
            ownerUserId: (preset as { ownerUserId?: string }).ownerUserId,
            createdByName: (preset as { createdByName?: string }).createdByName,
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
    basemapStyleId: "street-linksim",
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
    runtimeEnvironment: "production",
    state,
    useAppStore,
  };
});

vi.mock("../lib/cloudUser", () => ({
  CloudApiError: class CloudApiError extends Error {
    status: number | null;
    code: string;

    constructor(message: string, input?: { status?: number | null; code?: string }) {
      super(message);
      this.status = input?.status ?? null;
      this.code = input?.code ?? "api_error";
    }
  },
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

vi.mock("../lib/environment", () => ({
  getCurrentRuntimeEnvironment: () => hoisted.runtimeEnvironment,
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

import { AppShell, buildAuthStartPath } from "./AppShell";

const waitForCondition = async (check: () => boolean, timeoutMs = 2500): Promise<void> => {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const installLocalStorageMock = (): void => {
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
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });
};

const flushMicrotasks = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const renderAppShell = async (): Promise<ReturnType<typeof render>> => {
  const view = render(React.createElement(AppShell));
  await flushMicrotasks();
  return view;
};

const unmountAppShell = (view: ReturnType<typeof render>): void => {
  view.unmount();
};

const advanceTimers = async (ms: number): Promise<void> => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  await flushMicrotasks();
};

describe("AppShell deeplink cold-load flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.runtimeEnvironment = "production";
    installLocalStorageMock();
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
          ownerUserId: "user-1",
          createdByName: "Owner",
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

    window.history.replaceState(null, "", "/Owner/H%C3%B8gevarde-hyttefelt/Fyrisj%C3%B8vegen");
  });

  it("builds direct auth-start navigation for explicit sign-in clicks", () => {
    expect(buildAuthStartPath({ pathname: "/sim/site", search: "?mode=demo", hash: "#panel" })).toBe(
      "/api/auth-start?returnTo=%2Fsim%2Fsite%3Fmode%3Ddemo%23panel",
    );
  });

  it("loads the resolved simulation id and does not emit unavailable", async () => {
    const view = await renderAppShell();

    await waitForCondition(() => hoisted.loadSimulationPreset.mock.calls.length > 0);
    expect(hoisted.loadSimulationPreset).toHaveBeenCalledWith("sim-mmtk88wx-2didtk");

    const notifications = (
      window as Window & { linksimNotifications?: { list: () => Array<{ id: string }> } }
    ).linksimNotifications?.list?.() ?? [];
    expect(notifications.some((entry) => entry.id === "shared-simulation-unavailable")).toBe(false);

    unmountAppShell(view);
  });

  it("recovers automatically when a quick auth retry succeeds", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    hoisted.fetchMe
      .mockRejectedValueOnce(new Error("524 : server timed out"))
      .mockResolvedValueOnce({
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

    const view = await renderAppShell();

    try {
      expect(hoisted.fetchMe).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain("Cloud save is unavailable");

      await advanceTimers(2_000);

      expect(hoisted.fetchMe).toHaveBeenCalledTimes(2);
      expect(document.body.textContent).not.toContain("Cloud save is unavailable");
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("uses quick retries before falling back to the steady retry interval", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    hoisted.fetchMe.mockRejectedValue(new Error("524 : server timed out"));

    const view = await renderAppShell();

    try {
      expect(hoisted.fetchMe).toHaveBeenCalledTimes(1);

      await advanceTimers(1_999);
      expect(hoisted.fetchMe).toHaveBeenCalledTimes(1);

      await advanceTimers(1);
      expect(hoisted.fetchMe).toHaveBeenCalledTimes(2);

      await advanceTimers(5_000);
      expect(hoisted.fetchMe).toHaveBeenCalledTimes(3);

      await advanceTimers(10_000);
      expect(hoisted.fetchMe).toHaveBeenCalledTimes(4);

      await advanceTimers(59_999);
      expect(hoisted.fetchMe).toHaveBeenCalledTimes(4);

      await advanceTimers(1);
      expect(hoisted.fetchMe).toHaveBeenCalledTimes(5);
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("retries immediately when the browser comes online", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    hoisted.fetchMe
      .mockRejectedValueOnce(new Error("524 : server timed out"))
      .mockResolvedValueOnce({
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

    const view = await renderAppShell();

    try {
      expect(hoisted.fetchMe).toHaveBeenCalledTimes(1);
      window.dispatchEvent(new Event("online"));
      await flushMicrotasks();

      expect(hoisted.fetchMe).toHaveBeenCalledTimes(2);
      expect(document.body.textContent).not.toContain("Cloud save is unavailable");
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("stops auth recovery retries after success", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    hoisted.fetchMe
      .mockRejectedValueOnce(new Error("524 : server timed out"))
      .mockResolvedValueOnce({
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

    const view = await renderAppShell();

    try {
      await advanceTimers(2_000);
      expect(hoisted.fetchMe).toHaveBeenCalledTimes(2);

      await advanceTimers(60_000);
      expect(hoisted.fetchMe).toHaveBeenCalledTimes(2);
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("does not start auth recovery for local forced read-only mode", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    hoisted.runtimeEnvironment = "local";
    localStorage.setItem("linksim:local-force-readonly:v1", "1");

    const view = await renderAppShell();

    try {
      expect(hoisted.fetchMe).not.toHaveBeenCalled();
      await advanceTimers(120_000);
      expect(hoisted.fetchMe).not.toHaveBeenCalled();
    } finally {
      unmountAppShell(view);
      localStorage.removeItem("linksim:local-force-readonly:v1");
      vi.useRealTimers();
    }
  });

  it("does not start auth recovery for unauthenticated deep-link guests", async () => {
    vi.useFakeTimers();
    hoisted.fetchDeepLinkStatus.mockResolvedValue({
      status: "ok",
      simulationId: "sim-mmtk88wx-2didtk",
      authenticated: false,
    });

    const view = await renderAppShell();

    try {
      expect(hoisted.fetchDeepLinkStatus).toHaveBeenCalledTimes(1);
      expect(hoisted.fetchMe).not.toHaveBeenCalled();

      await advanceTimers(120_000);
      expect(hoisted.fetchMe).not.toHaveBeenCalled();
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("keeps the workspace visible and pins a warning when auth bootstrap times out", async () => {
    window.history.replaceState(null, "", "/");
    hoisted.fetchMe.mockRejectedValue(new Error("524 : server timed out"));

    const view = await renderAppShell();

    await waitForCondition(() => document.body.textContent?.includes("Cloud save is unavailable") === true);
    expect(document.querySelector(".access-locked-shell")).toBeNull();
    expect(document.body.textContent).not.toContain("Signed out");
    expect(document.body.textContent).toContain("Your changes may not be saved");
    expect(document.querySelector(".app-notification-item-error button")).toBeNull();

    unmountAppShell(view);
  });

  it("keeps the workspace visible for revoked accounts", async () => {
    window.history.replaceState(null, "", "/");
    hoisted.fetchMe.mockResolvedValue({
      id: "user-1",
      username: "Owner",
      isAdmin: false,
      isModerator: false,
      isApproved: false,
      accountState: "revoked",
      avatarUrl: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      bio: "",
    });

    const view = await renderAppShell();

    await waitForCondition(() => document.body.textContent?.includes("Account access is unavailable") === true);
    expect(document.querySelector(".access-locked-shell")).toBeNull();
    expect(document.body.textContent).toContain("Your changes may not be saved");

    unmountAppShell(view);
  });
});
