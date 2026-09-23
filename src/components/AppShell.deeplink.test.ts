// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";

const hoisted = vi.hoisted(() => {
  const fetchMe = vi.fn();
  const fetchAuthStatus = vi.fn();
  const fetchCloudLibrary = vi.fn();
  const fetchPublicSimulationLibrary = vi.fn();
  const loadSimulationPreset = vi.fn();
  const loadDemoScenario = vi.fn();
  const signInWithGithubPilot = vi.fn();
  const signInWithPasskeyPilot = vi.fn();
  const bootstrapPrivilegedPasskey = vi.fn();
  const signOutBetterAuthPilot = vi.fn();
  const completeLegacyMigration = vi.fn();
  const clearLegacyMigrationAttempt = vi.fn(() => {
    hoistedState.legacyMigrationConflictAttempt = null;
  });
  const markPendingLegacyMigrationConflict = vi.fn((
    _location: Location,
    _history: History,
    attemptId: string,
  ) => {
    hoistedState.legacyMigrationConflictAttempt = attemptId;
  });
  const startLegacyAccessMigration = vi.fn();
  const startPrivilegedPasskeyRecovery = vi.fn();
  const requestGithubAuthRecoveryReload = vi.fn(() => true);

  const hoistedState = { legacyMigrationConflictAttempt: null as string | null };
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
    loadDemoScenario,
    initializeCloudSync: () => {},
    performCloudSyncPush: async () => {},
    setCurrentUser: () => {},
    setAuthState: () => {},
    authState: "checking",
    currentUser: null,
    isOnline: true,
    setIsOnline: () => {},
    isInitializing: false,
    libraryRequest: null,
    openLibrary: () => {},
    closeLibrary: () => {},
    setShowNewSimulationRequest: () => {},
    basemapStyleId: "street-linksim",
  };

  const useAppStore = ((selector: (value: Record<string, unknown>) => unknown) => selector(state)) as unknown as {
    <T>(selector: (value: Record<string, unknown>) => T): T;
    getState: () => Record<string, unknown>;
  };
  useAppStore.getState = () => state;

  return {
    fetchMe,
    fetchAuthStatus,
    fetchCloudLibrary,
    fetchPublicSimulationLibrary,
    loadSimulationPreset,
    loadDemoScenario,
    signInWithGithubPilot,
    signInWithPasskeyPilot,
    bootstrapPrivilegedPasskey,
    signOutBetterAuthPilot,
    completeLegacyMigration,
    clearLegacyMigrationAttempt,
    markPendingLegacyMigrationConflict,
    startLegacyAccessMigration,
    startPrivilegedPasskeyRecovery,
    requestGithubAuthRecoveryReload,
    betterAuthPilotEnabled: false,
    authCallbackError: false,
    githubAuthReturn: false,
    githubAuthRecoveryReturn: false,
    legacyMigrationAttempt: null as string | null,
    privilegedPasskeyRecovery: false,
    hoistedState,
    sidebarTriggerVersion: 0,
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
  fetchAuthStatus: hoisted.fetchAuthStatus,
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

vi.mock("../lib/betterAuthPilot", () => ({
  consumeAuthCallbackError: vi.fn(() => hoisted.authCallbackError),
  consumeGithubAuthReturn: vi.fn(() => hoisted.githubAuthReturn),
  consumeGithubAuthRecovery: vi.fn(() => hoisted.githubAuthRecoveryReturn),
  getLegacyMigrationAttempt: vi.fn(() => hoisted.legacyMigrationAttempt),
  isPrivilegedPasskeyRecovery: vi.fn(() => hoisted.privilegedPasskeyRecovery),
  startLegacyAccessMigration: hoisted.startLegacyAccessMigration,
  startPrivilegedPasskeyRecovery: hoisted.startPrivilegedPasskeyRecovery,
  bootstrapPrivilegedPasskey: hoisted.bootstrapPrivilegedPasskey,
  completeLegacyMigration: hoisted.completeLegacyMigration,
  clearLegacyMigrationAttempt: hoisted.clearLegacyMigrationAttempt,
  hasPendingLegacyMigrationConflict: (_location: Location, attemptId: string) =>
    hoisted.hoistedState.legacyMigrationConflictAttempt === attemptId,
  markPendingLegacyMigrationConflict: hoisted.markPendingLegacyMigrationConflict,
  getLegacyMigrationUiErrorMessage: () => "LinkSim could not move this account to the new sign-in. Your existing account was not changed. Try again or contact an administrator.",
  clearGithubAuthRecovery: vi.fn(),
  requestGithubAuthRecoveryReload: hoisted.requestGithubAuthRecoveryReload,
  isBetterAuthPilotEnabled: () => hoisted.betterAuthPilotEnabled,
  signInWithGithubPilot: hoisted.signInWithGithubPilot,
  signInWithPasskeyPilot: hoisted.signInWithPasskeyPilot,
  signOutBetterAuthPilot: hoisted.signOutBetterAuthPilot,
  listBetterAuthPasskeys: vi.fn(async () => []),
  addBetterAuthPasskey: vi.fn(async () => {}),
  renameBetterAuthPasskey: vi.fn(async () => {}),
  removeBetterAuthPasskey: vi.fn(async () => {}),
  getPasskeyUiErrorMessage: (error: Error) => error.message === "Load failed"
    ? "Passkey sign-in could not reach LinkSim. Reload the page and try again, or sign in with GitHub."
    : "Passkey sign-in failed. Try again, or sign in with GitHub.",
  getGithubSignInUiErrorMessage: () => "GitHub sign-in could not start. Try again. If the problem continues, reload the page.",
}));

vi.mock("../store/appStore", () => ({
  useAppStore: hoisted.useAppStore,
}));

vi.mock("./MapView", () => ({ MapView: () => null }));
vi.mock("./Sidebar", () => ({
  Sidebar: ({ authBootstrapPending, onSignInRequested, onSignInTriggerReady, showSignInForAccessPilot }: {
    authBootstrapPending?: boolean;
    onSignInRequested?: (trigger: HTMLElement) => void;
    onSignInTriggerReady?: (trigger: HTMLButtonElement | null) => void;
    showSignInForAccessPilot?: boolean;
  }) =>
    authBootstrapPending
      ? React.createElement("div", { "aria-label": "Loading account" })
      : showSignInForAccessPilot || Boolean(hoisted.legacyMigrationAttempt)
      ? React.createElement("button", {
          key: hoisted.sidebarTriggerVersion,
          onClick: (event: React.MouseEvent<HTMLButtonElement>) => onSignInRequested?.(event.currentTarget),
          ref: onSignInTriggerReady,
        }, "Pilot sign in")
      : null,
}));
vi.mock("./UserAdminPanel", () => ({ UserAdminPanel: () => null }));
vi.mock("./WelcomeModal", () => ({ default: () => null }));
vi.mock("./OnboardingTutorialModal", () => ({ default: () => null }));
vi.mock("./LinkProfileChart", () => ({ LinkProfileChart: () => null }));
vi.mock("./PanoramaChart", () => ({ PanoramaChart: () => null }));
vi.mock("./ActionButton", () => ({ ActionButton: ({ children, variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }) => React.createElement("button", { ...props, "data-variant": variant }, children) }));
vi.mock("./InlineCloseIconButton", () => ({ InlineCloseIconButton: () => null }));
vi.mock("./ModalOverlay", () => ({
  ModalOverlay: ({ children, suspended, ...props }: { children?: React.ReactNode; suspended?: boolean; "aria-label": string }) =>
    React.createElement("div", {
      "aria-hidden": suspended || undefined,
      "aria-label": props["aria-label"],
      "data-modal-overlay": "true",
    }, children),
}));
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
import { buildRadioPresetShareHash } from "../lib/radioPresetShare";
import { simulationDefaultsFromPreset } from "../lib/simulationDefaults";

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
    hoisted.betterAuthPilotEnabled = false;
    hoisted.authCallbackError = false;
    hoisted.githubAuthReturn = false;
    hoisted.githubAuthRecoveryReturn = false;
    hoisted.legacyMigrationAttempt = null;
    hoisted.privilegedPasskeyRecovery = false;
    hoisted.hoistedState.legacyMigrationConflictAttempt = null;
    hoisted.sidebarTriggerVersion = 0;
    hoisted.requestGithubAuthRecoveryReload.mockReturnValue(true);
    hoisted.signInWithGithubPilot.mockResolvedValue("started");
    hoisted.signInWithPasskeyPilot.mockResolvedValue("signed-in");
    hoisted.bootstrapPrivilegedPasskey.mockResolvedValue(undefined);
    hoisted.signOutBetterAuthPilot.mockResolvedValue(undefined);
    hoisted.completeLegacyMigration.mockResolvedValue(undefined);
    hoisted.loadDemoScenario.mockReset();
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
      initializeCloudSync: () => {},
      setCurrentUser: () => {},
      setAuthState: () => {},
      isInitializing: false,
      libraryRequest: null,
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
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
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

  it("starts paired migration only from the explicit legacy-account choice", async () => {
    hoisted.betterAuthPilotEnabled = true;
    window.history.replaceState(null, "", "/");
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
      authSource: "access",
    });

    const view = await renderAppShell();
    try {
      const button = Array.from(document.querySelectorAll("button")).find((entry) => entry.textContent === "Pilot sign in");
      expect(button).toBeTruthy();
      fireEvent.click(button as HTMLButtonElement);
      await flushMicrotasks();
      expect(document.querySelector('[role="dialog"][aria-label="Sign in or sign up"]')).toBeTruthy();
      expect(hoisted.signInWithGithubPilot).not.toHaveBeenCalled();
      const legacy = document.querySelector('button[aria-label="Move existing Cloudflare account"]');
      fireEvent.click(legacy as HTMLButtonElement);
      await flushMicrotasks();
      expect(document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]')).toBeTruthy();
      expect(document.querySelector('[role="dialog"][aria-label="Sign in or sign up"]')).toBeNull();
      expect(hoisted.startLegacyAccessMigration).toHaveBeenCalledWith(window.location);
      expect(hoisted.signInWithGithubPilot).not.toHaveBeenCalled();
      expect(hoisted.fetchMe).toHaveBeenCalled();
    } finally {
      unmountAppShell(view);
    }
  });

  it("continues through GitHub after the Access proof created a migration attempt", async () => {
    hoisted.betterAuthPilotEnabled = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    let finishSignIn!: (result: "started") => void;
    hoisted.signInWithGithubPilot.mockImplementationOnce(() => new Promise((resolve) => {
      finishSignIn = resolve;
    }));
    let finishAuthStatus!: (value: { authenticated: boolean; authState: string; authSource: string }) => void;
    hoisted.fetchAuthStatus.mockImplementationOnce(() => new Promise((resolve) => {
      finishAuthStatus = resolve;
    }));

    const view = render(React.createElement(AppShell));
    try {
      await flushMicrotasks();
      expect(document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]')).toBeTruthy();
      expect(document.body.textContent).not.toContain("Cloudflare account confirmed");
      await waitForCondition(() => hoisted.signInWithGithubPilot.mock.calls.length === 1);
      expect(hoisted.signInWithGithubPilot).toHaveBeenCalledWith(window.location, expect.any(HTMLElement));
      finishAuthStatus({ authenticated: true, authState: "authenticated", authSource: "access" });
      await flushMicrotasks();
      hoisted.sidebarTriggerVersion = 1;
      view.rerender(React.createElement(AppShell));
      await flushMicrotasks();
      const replacementTrigger = Array.from(document.querySelectorAll("button"))
        .find((entry) => entry.textContent === "Pilot sign in");
      fireEvent.focusIn(replacementTrigger as HTMLButtonElement);
      await flushMicrotasks();
      expect(document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]')).toBeTruthy();
      expect(hoisted.signInWithGithubPilot).toHaveBeenCalledTimes(1);
      expect(hoisted.startLegacyAccessMigration).not.toHaveBeenCalled();
      finishSignIn("started");
      await flushMicrotasks();
      const continueButton = Array.from(document.querySelectorAll("button"))
        .find((entry) => entry.textContent === "Continue with GitHub");
      expect(continueButton).toBeTruthy();
      expect(continueButton).not.toBeDisabled();
    } finally {
      unmountAppShell(view);
    }
  });

  it("creates the authorized administrator passkey without starting GitHub", async () => {
    hoisted.betterAuthPilotEnabled = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    hoisted.privilegedPasskeyRecovery = true;
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
      authSource: "better-auth",
    });
    hoisted.fetchMe.mockResolvedValue({
      id: "legacy-admin",
      username: "admin",
      email: "",
      role: "admin",
      accountState: "active",
      needsUsername: false,
    });

    const view = await renderAppShell();
    try {
      expect(hoisted.signInWithGithubPilot).not.toHaveBeenCalled();
      const button = Array.from(document.querySelectorAll("button"))
        .find((entry) => entry.textContent === "Create administrator passkey");
      expect(button).toBeTruthy();
      fireEvent.click(button as HTMLButtonElement);
      await waitForCondition(() => hoisted.bootstrapPrivilegedPasskey.mock.calls.length === 1);
      expect(hoisted.bootstrapPrivilegedPasskey).toHaveBeenCalledWith(
        "78d2594f-6ef2-4d59-b8de-d42366a4c420",
        "Primary administrator passkey",
      );
      expect(hoisted.clearLegacyMigrationAttempt).toHaveBeenCalled();
      expect(hoisted.completeLegacyMigration).not.toHaveBeenCalled();
    } finally {
      unmountAppShell(view);
    }
  });

  it("keeps the embedded challenge mounted when the trigger is clicked during GitHub sign-in", async () => {
    hoisted.betterAuthPilotEnabled = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
      authSource: "access",
    });
    let finishSignIn!: (result: "started") => void;
    hoisted.signInWithGithubPilot.mockImplementationOnce(() => new Promise((resolve) => {
      finishSignIn = resolve;
    }));

    const view = await renderAppShell();
    try {
      const trigger = Array.from(document.querySelectorAll("button")).find((entry) => entry.textContent === "Pilot sign in");
      await flushMicrotasks();
      const challenge = document.querySelector<HTMLElement>('[aria-label="Anti-bot check"]');
      expect(challenge).toBeTruthy();
      await waitForCondition(() => hoisted.signInWithGithubPilot.mock.calls.length === 1);
      expect(hoisted.signInWithGithubPilot).toHaveBeenCalledTimes(1);

      fireEvent.click(trigger as HTMLButtonElement);
      await flushMicrotasks();
      expect(document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]')).toContainElement(challenge);

      finishSignIn("started");
      await flushMicrotasks();
    } finally {
      unmountAppShell(view);
    }
  });

  it("confirms a returned GitHub session before settling on Access", async () => {
    vi.useFakeTimers();
    hoisted.betterAuthPilotEnabled = true;
    hoisted.githubAuthReturn = true;
    window.history.replaceState(null, "", "/?workspace=local#panel");
    hoisted.fetchAuthStatus.mockResolvedValueOnce({
      authenticated: true,
      authState: "authenticated",
      authSource: "access",
    }).mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
      authSource: "better-auth",
    });

    const view = await renderAppShell();
    try {
      expect(hoisted.fetchAuthStatus).toHaveBeenCalledTimes(1);
      await advanceTimers(250);
      await waitForCondition(() => hoisted.fetchAuthStatus.mock.calls.length >= 2);
      expect(document.body.textContent).not.toContain("Pilot sign in");
      expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(
        "/?workspace=local#panel",
      );
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("consumes the paired migration before accepting the returned Better Auth session", async () => {
    hoisted.betterAuthPilotEnabled = true;
    hoisted.githubAuthReturn = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    window.history.replaceState(null, "", "/?legacyMigration=78d2594f-6ef2-4d59-b8de-d42366a4c420&auth-return=github");
    let finishAuthStatus!: (value: { authenticated: boolean; authState: string; authSource: string }) => void;
    hoisted.fetchAuthStatus.mockImplementationOnce(() => new Promise((resolve) => {
      finishAuthStatus = resolve;
    }));

    const view = await renderAppShell();
    try {
      await waitForCondition(() => hoisted.completeLegacyMigration.mock.calls.length === 1);
      expect(hoisted.completeLegacyMigration).toHaveBeenCalledWith("78d2594f-6ef2-4d59-b8de-d42366a4c420");
      expect(hoisted.signInWithGithubPilot).not.toHaveBeenCalled();
      expect(hoisted.clearLegacyMigrationAttempt).toHaveBeenCalledWith(window.location, window.history);
      expect(document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]')).toBeTruthy();
      finishAuthStatus({
        authenticated: true,
        authState: "authenticated",
        authSource: "better-auth",
      });
      await flushMicrotasks();
      expect(document.body.textContent).toContain("Your existing LinkSim account now uses the new sign-in.");
      expect(document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]')).toBeNull();
    } finally {
      unmountAppShell(view);
    }
  });

  it("keeps a failed mapping in the modal and restarts the complete migration", async () => {
    hoisted.betterAuthPilotEnabled = true;
    hoisted.githubAuthReturn = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    hoisted.completeLegacyMigration.mockRejectedValueOnce(new Error("internal migration details"));
    window.history.replaceState(null, "", "/?legacyMigration=78d2594f-6ef2-4d59-b8de-d42366a4c420&auth-return=github");

    const view = await renderAppShell();
    try {
      await waitForCondition(() => hoisted.completeLegacyMigration.mock.calls.length === 1);
      await flushMicrotasks();
      const modal = document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]');
      expect(modal).toBeTruthy();
      expect(modal).toHaveTextContent(
        "LinkSim could not move this account to the new sign-in. Your existing account was not changed. Try again or contact an administrator.",
      );
      const restart = Array.from(modal?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent === "Start migration again");
      fireEvent.click(restart as HTMLButtonElement);
      await waitForCondition(() => hoisted.startLegacyAccessMigration.mock.calls.length === 1);
      expect(hoisted.clearLegacyMigrationAttempt).toHaveBeenCalledWith(window.location, window.history);
      expect(hoisted.startLegacyAccessMigration).toHaveBeenCalledWith(window.location);
    } finally {
      unmountAppShell(view);
    }
  });

  it("offers the existing mapped GitHub profile when migration reports an identity conflict", async () => {
    const setCurrentUser = vi.fn();
    const initializeCloudSync = vi.fn();
    Object.assign(hoisted.state, { initializeCloudSync, setCurrentUser });
    hoisted.betterAuthPilotEnabled = true;
    hoisted.githubAuthReturn = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    hoisted.completeLegacyMigration.mockRejectedValueOnce(Object.assign(
      new Error("legacy identity differs from the existing mapping"),
      { code: "MIGRATION_CONFLICT", status: 409 },
    ));
    hoisted.fetchAuthStatus.mockResolvedValueOnce({
      authenticated: true,
      authState: "authenticated",
      authSource: "better-auth",
    });
    window.history.replaceState(null, "", "/?legacyMigration=78d2594f-6ef2-4d59-b8de-d42366a4c420&auth-return=github");

    const view = await renderAppShell();
    try {
      await waitForCondition(() => hoisted.fetchMe.mock.calls.length === 1);
      await flushMicrotasks();
      expect(hoisted.clearLegacyMigrationAttempt).not.toHaveBeenCalled();
      const modal = document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]');
      expect(modal).toBeTruthy();
      expect(modal).toHaveTextContent(
        "GitHub signed you in as Owner. That profile is connected to a different LinkSim account, so your Cloudflare account was not moved.",
      );
      const continueButton = Array.from(modal?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent === "Continue as Owner");
      expect(continueButton).toBeTruthy();
      expect(setCurrentUser).not.toHaveBeenCalled();
      expect(initializeCloudSync).not.toHaveBeenCalled();
      fireEvent.click(continueButton as HTMLButtonElement);
      expect(document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]')).toBeNull();
      expect(hoisted.clearLegacyMigrationAttempt).toHaveBeenCalledWith(window.location, window.history);
      expect(setCurrentUser).toHaveBeenCalledWith(expect.objectContaining({ id: "user-1", username: "Owner" }));
      await waitForCondition(() => initializeCloudSync.mock.calls.length === 1);
      expect(document.body.textContent).not.toContain("Your existing LinkSim account now uses the new sign-in.");
    } finally {
      unmountAppShell(view);
    }
  });

  it("does not activate the existing GitHub profile when migration is restarted", async () => {
    const setCurrentUser = vi.fn();
    const initializeCloudSync = vi.fn();
    Object.assign(hoisted.state, { initializeCloudSync, setCurrentUser });
    hoisted.betterAuthPilotEnabled = true;
    hoisted.githubAuthReturn = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    hoisted.completeLegacyMigration.mockRejectedValueOnce(Object.assign(
      new Error("legacy identity differs from the existing mapping"),
      { code: "MIGRATION_CONFLICT", status: 409 },
    ));
    hoisted.fetchAuthStatus.mockResolvedValueOnce({
      authenticated: true,
      authState: "authenticated",
      authSource: "better-auth",
    });
    window.history.replaceState(null, "", "/?legacyMigration=78d2594f-6ef2-4d59-b8de-d42366a4c420&auth-return=github");

    const view = await renderAppShell();
    try {
      await waitForCondition(() => hoisted.fetchMe.mock.calls.length === 1);
      await flushMicrotasks();
      const modal = document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]');
      const restartButton = Array.from(modal?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent === "Start migration again");
      expect(restartButton).toBeTruthy();
      expect(setCurrentUser).not.toHaveBeenCalled();
      expect(initializeCloudSync).not.toHaveBeenCalled();
      fireEvent.click(restartButton as HTMLButtonElement);
      await waitForCondition(() => hoisted.startLegacyAccessMigration.mock.calls.length === 1);
      expect(setCurrentUser).not.toHaveBeenCalled();
      expect(initializeCloudSync).not.toHaveBeenCalled();
    } finally {
      unmountAppShell(view);
    }
  });

  it("restores the unresolved profile choice after reloading without the consumed GitHub return", async () => {
    const attemptId = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    const setCurrentUser = vi.fn();
    const initializeCloudSync = vi.fn();
    Object.assign(hoisted.state, { initializeCloudSync, setCurrentUser });
    hoisted.betterAuthPilotEnabled = true;
    hoisted.githubAuthReturn = true;
    hoisted.legacyMigrationAttempt = attemptId;
    hoisted.completeLegacyMigration.mockRejectedValueOnce(Object.assign(
      new Error("legacy identity differs from the existing mapping"),
      { code: "MIGRATION_CONFLICT", status: 409 },
    ));
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
      authSource: "better-auth",
    });
    window.history.replaceState(null, "", `/?legacyMigration=${attemptId}&auth-return=github`);

    const firstView = await renderAppShell();
    await waitForCondition(() => hoisted.markPendingLegacyMigrationConflict.mock.calls.length === 1);
    await waitForCondition(() => hoisted.fetchMe.mock.calls.length === 1);
    unmountAppShell(firstView);

    hoisted.githubAuthReturn = false;
    window.history.replaceState(null, "", `/?legacyMigration=${attemptId}&legacyMigrationConflict=${attemptId}`);
    setCurrentUser.mockClear();
    initializeCloudSync.mockClear();
    hoisted.fetchMe.mockClear();

    const secondView = await renderAppShell();
    try {
      await waitForCondition(() => hoisted.fetchMe.mock.calls.length === 1);
      await flushMicrotasks();
      const modal = document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]');
      expect(modal).toHaveTextContent("Continue as Owner");
      expect(setCurrentUser).not.toHaveBeenCalled();
      expect(initializeCloudSync).not.toHaveBeenCalled();
      expect(hoisted.completeLegacyMigration).toHaveBeenCalledTimes(1);
    } finally {
      unmountAppShell(secondView);
    }
  });

  it("keeps the migration conflict visible when the GitHub session has no loadable profile", async () => {
    hoisted.betterAuthPilotEnabled = true;
    hoisted.githubAuthReturn = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    hoisted.completeLegacyMigration.mockRejectedValueOnce(Object.assign(
      new Error("legacy identity differs from the existing mapping"),
      { code: "MIGRATION_CONFLICT", status: 409 },
    ));
    hoisted.fetchAuthStatus.mockResolvedValueOnce({
      authenticated: true,
      authState: "authenticated",
      authSource: "better-auth",
    });
    hoisted.fetchMe.mockRejectedValueOnce(new Error("profile unavailable"));
    window.history.replaceState(null, "", "/?legacyMigration=78d2594f-6ef2-4d59-b8de-d42366a4c420&auth-return=github");

    const view = await renderAppShell();
    try {
      await waitForCondition(() => hoisted.fetchMe.mock.calls.length === 1);
      await flushMicrotasks();
      const modal = document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]');
      expect(modal).toBeTruthy();
      expect(modal).toHaveTextContent(
        "LinkSim could not move this account to the new sign-in. Your existing account was not changed. Try again or contact an administrator.",
      );
      expect(Array.from(modal?.querySelectorAll("button") ?? []))
        .toContainEqual(expect.objectContaining({ textContent: "Start migration again" }));
    } finally {
      unmountAppShell(view);
    }
  });

  it("keeps the migration conflict visible for a revoked mapped profile", async () => {
    hoisted.betterAuthPilotEnabled = true;
    hoisted.githubAuthReturn = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    hoisted.completeLegacyMigration.mockRejectedValueOnce(Object.assign(
      new Error("legacy identity differs from the existing mapping"),
      { code: "MIGRATION_CONFLICT", status: 409 },
    ));
    hoisted.fetchAuthStatus.mockResolvedValueOnce({
      authenticated: true,
      authState: "authenticated",
      authSource: "better-auth",
    });
    hoisted.fetchMe.mockResolvedValueOnce({
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
    window.history.replaceState(null, "", "/?legacyMigration=78d2594f-6ef2-4d59-b8de-d42366a4c420&auth-return=github");

    const view = await renderAppShell();
    try {
      await waitForCondition(() => hoisted.fetchMe.mock.calls.length === 1);
      await flushMicrotasks();
      const modal = document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]');
      expect(modal).toBeTruthy();
      expect(modal).toHaveTextContent(
        "LinkSim could not move this account to the new sign-in. Your existing account was not changed. Try again or contact an administrator.",
      );
    } finally {
      unmountAppShell(view);
    }
  });

  it("keeps the migration conflict restartable when the auth probe is revoked", async () => {
    hoisted.betterAuthPilotEnabled = true;
    hoisted.githubAuthReturn = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    hoisted.completeLegacyMigration.mockRejectedValueOnce(Object.assign(
      new Error("legacy identity differs from the existing mapping"),
      { code: "MIGRATION_CONFLICT", status: 409 },
    ));
    hoisted.fetchAuthStatus.mockResolvedValueOnce({
      authenticated: false,
      authState: "revoked",
      authSource: "better-auth",
    });
    window.history.replaceState(null, "", "/?legacyMigration=78d2594f-6ef2-4d59-b8de-d42366a4c420&auth-return=github");

    const view = await renderAppShell();
    try {
      await waitForCondition(() => hoisted.fetchAuthStatus.mock.calls.length === 1);
      await flushMicrotasks();
      const modal = document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]');
      expect(modal).toBeTruthy();
      expect(modal).toHaveTextContent(
        "LinkSim could not move this account to the new sign-in. Your existing account was not changed. Try again or contact an administrator.",
      );
      expect(Array.from(modal?.querySelectorAll("button") ?? []).some(
        (button) => button.textContent === "Start migration again",
      )).toBe(true);
      expect(hoisted.fetchMe).not.toHaveBeenCalled();
    } finally {
      unmountAppShell(view);
    }
  });

  it("keeps an unresolved migration conflict instead of losing it to session-recovery reload", async () => {
    vi.useFakeTimers();
    hoisted.betterAuthPilotEnabled = true;
    hoisted.githubAuthReturn = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    hoisted.completeLegacyMigration.mockRejectedValueOnce(Object.assign(
      new Error("legacy identity differs from the existing mapping"),
      { code: "MIGRATION_CONFLICT", status: 409 },
    ));
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
      authSource: "access",
    });
    window.history.replaceState(null, "", "/?legacyMigration=78d2594f-6ef2-4d59-b8de-d42366a4c420&auth-return=github");

    const view = await renderAppShell();
    try {
      await advanceTimers(250);
      await advanceTimers(750);
      await advanceTimers(1_500);
      await flushMicrotasks();
      const modal = document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]');
      expect(modal).toBeTruthy();
      expect(modal).toHaveTextContent(
        "LinkSim could not move this account to the new sign-in. Your existing account was not changed. Try again or contact an administrator.",
      );
      expect(Array.from(modal?.querySelectorAll("button") ?? []).some(
        (button) => button.textContent === "Start migration again",
      )).toBe(true);
      expect(hoisted.requestGithubAuthRecoveryReload).not.toHaveBeenCalled();
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("restores the migration conflict when the mapped-session probe times out", async () => {
    vi.useFakeTimers();
    hoisted.betterAuthPilotEnabled = true;
    hoisted.githubAuthReturn = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    hoisted.completeLegacyMigration.mockRejectedValueOnce(Object.assign(
      new Error("legacy identity differs from the existing mapping"),
      { code: "MIGRATION_CONFLICT", status: 409 },
    ));
    hoisted.fetchAuthStatus.mockImplementationOnce(() => new Promise(() => {}));
    window.history.replaceState(null, "", "/?legacyMigration=78d2594f-6ef2-4d59-b8de-d42366a4c420&auth-return=github");

    const view = await renderAppShell();
    try {
      await flushMicrotasks();
      await advanceTimers(10_000);
      const modal = document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]');
      expect(modal).toBeTruthy();
      expect(modal).toHaveTextContent(
        "LinkSim could not move this account to the new sign-in. Your existing account was not changed. Try again or contact an administrator.",
      );
      expect(Array.from(modal?.querySelectorAll("button") ?? []).some(
        (button) => button.textContent === "Start migration again",
      )).toBe(true);
      expect(hoisted.requestGithubAuthRecoveryReload).not.toHaveBeenCalled();
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("retains GitHub return recovery through Strict Mode effect replay", async () => {
    vi.useFakeTimers();
    hoisted.betterAuthPilotEnabled = true;
    const { consumeGithubAuthReturn } = await import("../lib/betterAuthPilot");
    vi.mocked(consumeGithubAuthReturn)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
      authSource: "access",
    });

    const view = render(
      React.createElement(React.StrictMode, null, React.createElement(AppShell)),
    );
    await flushMicrotasks();
    try {
      const initialChecks = hoisted.fetchAuthStatus.mock.calls.length;
      expect(initialChecks).toBeGreaterThan(0);
      await advanceTimers(250);
      expect(hoisted.fetchAuthStatus.mock.calls.length).toBeGreaterThan(initialChecks);
    } finally {
      vi.mocked(consumeGithubAuthReturn).mockImplementation(() => hoisted.githubAuthReturn);
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("reloads the returned page once when Safari cannot see the GitHub session", async () => {
    vi.useFakeTimers();
    hoisted.betterAuthPilotEnabled = true;
    hoisted.githubAuthReturn = true;
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
      authSource: "access",
    });

    const view = await renderAppShell();
    try {
      await advanceTimers(250);
      await advanceTimers(750);
      await advanceTimers(1_500);
      await waitForCondition(() => hoisted.requestGithubAuthRecoveryReload.mock.calls.length === 1);
      expect(hoisted.fetchAuthStatus).toHaveBeenCalledTimes(4);
      expect(document.body.textContent).not.toContain("could not confirm the new session");
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("stops after the recovery reload and explains that the browser did not retain the session", async () => {
    vi.useFakeTimers();
    hoisted.betterAuthPilotEnabled = true;
    hoisted.githubAuthRecoveryReturn = true;
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
      authSource: "access",
    });

    const view = await renderAppShell();
    try {
      await advanceTimers(250);
      await advanceTimers(750);
      await advanceTimers(1_500);
      await waitForCondition(() => document.body.textContent?.includes("browser did not retain the LinkSim session") === true);
      expect(hoisted.fetchAuthStatus).toHaveBeenCalledTimes(4);
      expect(hoisted.requestGithubAuthRecoveryReload).not.toHaveBeenCalled();
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("signs in with a passkey without navigating away from the current workspace", async () => {
    hoisted.betterAuthPilotEnabled = true;
    window.history.replaceState(null, "", "/?workspace=local#panel");
    hoisted.fetchAuthStatus.mockResolvedValueOnce({
      authenticated: true,
      authState: "authenticated",
      authSource: "access",
    }).mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
      authSource: "better-auth",
    });

    const view = await renderAppShell();
    try {
      const trigger = Array.from(document.querySelectorAll("button")).find((entry) => entry.textContent === "Pilot sign in");
      fireEvent.click(trigger as HTMLButtonElement);
      await flushMicrotasks();
      const passkey = document.querySelector('button[aria-label="Passkey"]');
      fireEvent.click(passkey as HTMLButtonElement);
      await flushMicrotasks();
      expect(hoisted.signInWithPasskeyPilot).toHaveBeenCalledOnce();
      expect(document.body.textContent).toContain("Passkey accepted. Finishing sign-in…");
      await waitForCondition(() => hoisted.fetchAuthStatus.mock.calls.length >= 2);
      expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe("/?workspace=local#panel");
    } finally {
      unmountAppShell(view);
    }
  });

  it("explains how to recover when mobile passkey sign-in cannot reach the auth endpoint", async () => {
    hoisted.betterAuthPilotEnabled = true;
    hoisted.signInWithPasskeyPilot.mockRejectedValueOnce(new TypeError("Load failed"));
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
      authSource: "access",
    });
    window.history.replaceState(null, "", "/");

    const view = await renderAppShell();
    try {
      const trigger = Array.from(document.querySelectorAll("button")).find((entry) => entry.textContent === "Pilot sign in");
      fireEvent.click(trigger as HTMLButtonElement);
      await flushMicrotasks();
      const passkey = document.querySelector('button[aria-label="Passkey"]');
      fireEvent.click(passkey as HTMLButtonElement);
      await flushMicrotasks();
      expect(document.body.textContent).toContain(
        "Passkey sign-in could not reach LinkSim. Reload the page and try again, or sign in with GitHub.",
      );
      expect(document.querySelector('[role="dialog"][aria-label="Sign in or sign up"]')).toBeTruthy();
    } finally {
      unmountAppShell(view);
    }
  });

  it("enters anonymous mode without a cloud-save warning after explicit Better Auth sign-out", async () => {
    hoisted.betterAuthPilotEnabled = true;
    const user = {
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
    };
    Object.assign(hoisted.state, {
      currentUser: user,
      authState: "signed_in",
      setCurrentUser: (next: unknown) => {
        hoisted.state.currentUser = next;
      },
      setAuthState: (next: unknown) => {
        hoisted.state.authState = next;
      },
    });
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
      authSource: "better-auth",
    });
    hoisted.fetchMe.mockResolvedValue(user);
    localStorage.setItem("linksim:had-authenticated-session:v1", "1");
    window.history.replaceState(null, "", "/settings/profile");

    const view = await renderAppShell();
    try {
      await waitForCondition(() => Array.from(document.querySelectorAll("button"))
        .some((entry) => entry.textContent === "Sign out"));
      const signOut = Array.from(document.querySelectorAll("button"))
        .find((entry) => entry.textContent === "Sign out");
      fireEvent.click(signOut as HTMLButtonElement);
      await waitForCondition(() => hoisted.signOutBetterAuthPilot.mock.calls.length === 1);
      await flushMicrotasks();

      expect(hoisted.state.authState).toBe("signed_out");
      expect(localStorage.getItem("linksim:had-authenticated-session:v1")).toBeNull();
      expect(document.body.textContent).not.toContain("Cloud save is unavailable");
      expect(hoisted.loadDemoScenario).not.toHaveBeenCalled();
      expect(window.location.pathname).toBe("/");
    } finally {
      unmountAppShell(view);
    }
  });

  it("keeps the chooser open and explains a GitHub initiation failure", async () => {
    hoisted.betterAuthPilotEnabled = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    hoisted.signInWithGithubPilot
      .mockRejectedValueOnce(new Error("database connection string leaked"))
      .mockResolvedValueOnce("started");
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: true,
      authState: "authenticated",
      authSource: "access",
    });

    const view = await renderAppShell();
    try {
      await flushMicrotasks();
      await waitForCondition(() => hoisted.signInWithGithubPilot.mock.calls.length === 1);
      await flushMicrotasks();
      expect(document.body.textContent).toContain(
        "GitHub sign-in could not start. Try again. If the problem continues, reload the page.",
      );
      const modal = document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]');
      expect(modal).toBeTruthy();
      const retry = Array.from(modal?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent === "Try GitHub again");
      fireEvent.click(retry as HTMLButtonElement);
      await waitForCondition(() => hoisted.signInWithGithubPilot.mock.calls.length === 2);
    } finally {
      unmountAppShell(view);
    }
  });

  it("does not trap a stale migration URL when the Better Auth pilot is disabled", async () => {
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";

    const view = await renderAppShell();
    try {
      expect(document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]')).toBeNull();
      expect(hoisted.signInWithGithubPilot).not.toHaveBeenCalled();
    } finally {
      unmountAppShell(view);
    }
  });

  it("reports a cleaned-up GitHub callback failure through app notifications", async () => {
    hoisted.betterAuthPilotEnabled = true;
    hoisted.authCallbackError = true;
    window.history.replaceState(null, "", "/");

    const view = await renderAppShell();
    try {
      expect(document.body.textContent).toContain("GitHub sign-in failed. Try again.");
    } finally {
      unmountAppShell(view);
    }
  });

  it("does not restart GitHub automatically after a failed migration callback", async () => {
    hoisted.betterAuthPilotEnabled = true;
    hoisted.authCallbackError = true;
    hoisted.legacyMigrationAttempt = "78d2594f-6ef2-4d59-b8de-d42366a4c420";
    window.history.replaceState(null, "", "/?legacyMigration=78d2594f-6ef2-4d59-b8de-d42366a4c420&auth-error=github");
    const { consumeAuthCallbackError } = await import("../lib/betterAuthPilot");
    vi.mocked(consumeAuthCallbackError)
      .mockReturnValueOnce(true)
      .mockReturnValue(false);

    const view = render(
      React.createElement(React.StrictMode, null, React.createElement(AppShell)),
    );
    await flushMicrotasks();
    try {
      await flushMicrotasks();
      expect(document.body.textContent).toContain("GitHub sign-in failed. Try GitHub again to continue moving your account.");
      expect(document.querySelector('[data-modal-overlay][aria-label="Move your LinkSim account"]')).toBeTruthy();
      expect(hoisted.signInWithGithubPilot).not.toHaveBeenCalled();
    } finally {
      vi.mocked(consumeAuthCallbackError).mockImplementation(() => hoisted.authCallbackError);
      unmountAppShell(view);
    }
  });

  it("previews every shared radio preset value before an anonymous import", async () => {
    const defaults = {
      ...simulationDefaultsFromPreset("mt-eu_868"),
      frequencyMHz: 869.4,
      rxSensitivityTargetDbm: -127,
      autoPropagationEnvironment: false,
    };
    window.history.replaceState(null, "", `/${buildRadioPresetShareHash({ name: "Alpine Mesh", defaults })}`);
    hoisted.fetchMe.mockRejectedValue(new Error("Unauthorized"));
    hoisted.fetchAuthStatus.mockResolvedValue({ authenticated: false, authState: "guest" });

    const view = await renderAppShell();
    try {
      expect(document.body.textContent).toContain("Import Radio Preset");
      expect(document.body.textContent).toContain("Alpine Mesh");
      expect(document.body.textContent).toContain("869.4 MHz");
      expect(document.body.textContent).toContain("-127 dBm");
      expect(document.body.textContent).toContain("Sign in to save");
    } finally {
      unmountAppShell(view);
    }
  });

  it("renders the preset import above and suspends the Settings dialog", async () => {
    const defaults = { ...simulationDefaultsFromPreset("mt-eu_868"), autoPropagationEnvironment: false };
    window.history.replaceState(null, "", `/settings/preferences${buildRadioPresetShareHash({ name: "Alpine Mesh", defaults })}`);

    const view = await renderAppShell();
    try {
      const settings = document.querySelector<HTMLElement>('[data-modal-overlay="true"][aria-label="Settings"]');
      const presetImport = document.querySelector<HTMLElement>('[data-modal-overlay="true"][aria-label="Import radio preset"]');
      expect(settings).not.toBeNull();
      expect(presetImport).not.toBeNull();
      expect(settings).toHaveAttribute("aria-hidden", "true");
      expect((settings as Node).compareDocumentPosition(presetImport as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } finally {
      unmountAppShell(view);
    }
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
      expect(localStorage.getItem("linksim:had-authenticated-session:v1")).toBe("1");
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("stops after the bounded quick retry sequence", async () => {
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

      await advanceTimers(120_000);
      expect(hoisted.fetchMe).toHaveBeenCalledTimes(4);
      expect(document.body.textContent).toContain("Sign in again to resume cloud saving");
      expect(document.body.textContent).not.toContain("retrying automatically");
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
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: false,
      authState: "guest",
    });

    const view = await renderAppShell();

    try {
      expect(hoisted.fetchAuthStatus).toHaveBeenCalledTimes(1);
      expect(hoisted.fetchMe).not.toHaveBeenCalled();

      await advanceTimers(120_000);
      expect(hoisted.fetchMe).not.toHaveBeenCalled();
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("enters quiet demo mode for an expected root guest", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: false,
      authState: "guest",
    });

    const view = await renderAppShell();

    try {
      expect(hoisted.fetchAuthStatus).toHaveBeenCalledTimes(1);
      expect(hoisted.fetchMe).not.toHaveBeenCalled();
      expect(document.body.textContent).not.toContain("Cloud save is unavailable");

      await advanceTimers(120_000);
      expect(hoisted.fetchAuthStatus).toHaveBeenCalledTimes(1);
      expect(hoisted.fetchMe).not.toHaveBeenCalled();
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("shows an expired-session warning without retrying for a prior authenticated guest", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    localStorage.setItem("linksim:had-authenticated-session:v1", "1");
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: false,
      authState: "guest",
    });

    const view = await renderAppShell();

    try {
      expect(document.body.textContent).toContain("Sign in again to resume cloud saving");
      expect(document.body.textContent).not.toContain("retrying automatically");
      expect(hoisted.fetchMe).not.toHaveBeenCalled();

      await advanceTimers(120_000);
      expect(hoisted.fetchAuthStatus).toHaveBeenCalledTimes(1);
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("shows an actionable revoked-session warning without retrying", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    hoisted.fetchAuthStatus.mockResolvedValue({
      authenticated: false,
      authState: "revoked",
    });

    const view = await renderAppShell();

    try {
      expect(document.body.textContent).toContain("Account access is unavailable");
      expect(document.body.textContent).not.toContain("retrying automatically");
      expect(hoisted.fetchMe).not.toHaveBeenCalled();

      await advanceTimers(120_000);
      expect(hoisted.fetchAuthStatus).toHaveBeenCalledTimes(1);
    } finally {
      unmountAppShell(view);
      vi.useRealTimers();
    }
  });

  it("uses a bounded neutral recovery path when the public auth probe fails", async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/");
    hoisted.fetchAuthStatus.mockRejectedValue(new Error("Failed to fetch"));

    const view = await renderAppShell();

    try {
      expect(document.body.textContent).toContain("Sign-in status could not be checked");
      expect(document.body.textContent).not.toContain("Cloud save is unavailable");

      await advanceTimers(2_000);
      await advanceTimers(5_000);
      await advanceTimers(10_000);
      expect(hoisted.fetchAuthStatus).toHaveBeenCalledTimes(4);

      await advanceTimers(120_000);
      expect(hoisted.fetchAuthStatus).toHaveBeenCalledTimes(4);
      expect(document.body.textContent).toContain("Try signing in again");
      expect(document.body.textContent).not.toContain("retrying automatically");
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
