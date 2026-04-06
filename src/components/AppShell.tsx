import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleUserRound, CircleX, CloudAlert, Copy, Globe, Maximize2, PanelBottom, PanelBottomClose, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose, Share, UserRoundPlus, UserRoundSearch, Users } from "lucide-react";
import { type CollaboratorDirectoryUser, fetchCollaboratorDirectory, fetchDeepLinkStatus, fetchMe, setLocalDevRole } from "../lib/cloudUser";
import { fetchCloudLibrary, fetchPublicSimulationLibrary, pushCloudLibrary } from "../lib/cloudLibrary";
import { buildDeepLinkPathname, buildDeepLinkUrl, canonicalizeDeepLinkKey, parseDeepLinkFromLocation, slugifyName } from "../lib/deepLink";
import { canRunDeepLinkApply } from "../lib/deepLinkApplyGate";
import {
  formatPrivateSiteReferenceBlockMessage,
  type DeepLinkApplyOutcome,
  isAuthSignInRequiredMessage,
  shouldCloseSimulationLibraryOnLoad,
  shouldRewritePathAfterDeepLinkApply,
  shouldUseReadonlyFallbackForAuthBootstrap,
} from "../lib/appShellGuards";
import { emptyWorkspaceState } from "../lib/emptyWorkspaceState";
import { getCurrentRuntimeEnvironment } from "../lib/environment";
import { getUiErrorMessage } from "../lib/uiError";
import { initializeMigrations, runMigrations } from "../lib/migrations";
import { resolveBasemapSelection } from "../lib/basemaps";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { useAppStore } from "../store/appStore";
import { LinkProfileChart } from "./LinkProfileChart";
import { MapView } from "./MapView";
import { ModalOverlay } from "./ModalOverlay";
import OnboardingTutorialModal from "./OnboardingTutorialModal";
import SimulationLibraryPanel from "./SimulationLibraryPanel";
import WelcomeModal from "./WelcomeModal";
import { Sidebar } from "./Sidebar";
import { UserAdminPanel } from "./UserAdminPanel";
import { MobileWorkspaceTabs } from "./app-shell/MobileWorkspaceTabs";
import { useOnboardingFlow } from "./app-shell/useOnboardingFlow";

initializeMigrations();

const LAST_SIMULATION_REF_KEY = "rmw-last-simulation-ref-v1";
const ONBOARDING_SEEN_KEY_PREFIX = "linksim:onboarding-seen:v1:";
const LOCAL_FORCE_READONLY_KEY = "linksim:local-force-readonly:v1";
const OPEN_SYNC_MODAL_EVENT = "linksim:open-sync-modal";
const ACCESS_CHECK_TIMEOUT_MS = 10_000;
type MobileWorkspacePanel = "navigator" | "inspector" | "profile";
type MobileBottomPanelMode = "hidden" | "normal" | "full";
type AppNotice = {
  id: string;
  message: string;
  tone: "info" | "warning" | "error";
  persistent: boolean;
};

const UI_PANEL_KEYS = {
  navigatorHidden: "linksim-ui-navigator-hidden-v1",
  inspectorHidden: "linksim-ui-inspector-hidden-v1",
  profileHidden: "linksim-ui-profile-hidden-v1",
} as const;

const readPanelBool = (key: string, fallback: boolean): boolean => {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
};

const toVisibility = (value: unknown): "private" | "public" | "shared" =>
  value === "shared" || value === "public" ? value : "private";

const canEditResource = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const resource = value as { effectiveRole?: unknown };
  const role = resource.effectiveRole;
  if (role === "owner" || role === "admin" || role === "editor") return true;
  return false;
};

const copyToClipboard = async (textOrPromise: string | Promise<string>): Promise<void> => {
  // When the content is deferred (a Promise), use ClipboardItem so the clipboard
  // write is registered within the current user-gesture context while the content
  // resolves asynchronously. This prevents NotAllowedError after awaited network calls.
  if (textOrPromise instanceof Promise) {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": textOrPromise.then((t) => new Blob([t], { type: "text/plain" })),
        }),
      ]);
      return;
    }
    // Fallback for browsers without ClipboardItem (e.g. Firefox): resolve first.
    await copyToClipboard(await textOrPromise);
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(textOrPromise);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = textOrPromise;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
};

export function AppShell() {
  const srtmTilesCount = useAppStore((state) => state.srtmTiles.length);
  const recommendAndFetchTerrainForCurrentArea = useAppStore(
    (state) => state.recommendAndFetchTerrainForCurrentArea,
  );
  const importLibraryData = useAppStore((state) => state.importLibraryData);
  const loadSimulationPreset = useAppStore((state) => state.loadSimulationPreset);
  const setSelectedLinkId = useAppStore((state) => state.setSelectedLinkId);
  const setSelectedSiteId = useAppStore((state) => state.setSelectedSiteId);
  const selectSiteById = useAppStore((state) => state.selectSiteById);
  const clearActiveSelection = useAppStore((state) => state.clearActiveSelection);
  const setMapOverlayMode = useAppStore((state) => state.setMapOverlayMode);
  const updateMapViewport = useAppStore((state) => state.updateMapViewport);
  const updateSimulationPresetEntry = useAppStore((state) => state.updateSimulationPresetEntry);
  const updateSiteLibraryEntry = useAppStore((state) => state.updateSiteLibraryEntry);
  const selectedScenarioId = useAppStore((state) => state.selectedScenarioId);
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const links = useAppStore((state) => state.links);
  const simulationPresets = useAppStore((state) => state.simulationPresets);
  const siteLibrary = useAppStore((state) => state.siteLibrary);
  const sites = useAppStore((state) => state.sites);
  const selectedSiteIds = useAppStore((state) => state.selectedSiteIds);
  const loadDemoScenario = useAppStore((state) => state.loadDemoScenario);
  const initializeCloudSync = useAppStore((state) => state.initializeCloudSync);
  const performCloudSyncPush = useAppStore((state) => state.performCloudSyncPush);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const setAuthState = useAppStore((state) => state.setAuthState);
  const authState = useAppStore((state) => state.authState);
  const currentUser = useAppStore((state) => state.currentUser);
  const isOnline = useAppStore((state) => state.isOnline);
  const setIsOnline = useAppStore((state) => state.setIsOnline);
  const isInitializing = useAppStore((state) => state.isInitializing);
  const showSimulationLibraryRequest = useAppStore((state) => state.showSimulationLibraryRequest);
  const setShowSimulationLibraryRequest = useAppStore((state) => state.setShowSimulationLibraryRequest);
  const setShowNewSimulationRequest = useAppStore((state) => state.setShowNewSimulationRequest);
  const setShowSiteLibraryRequest = useAppStore((state) => state.setShowSiteLibraryRequest);
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [isProfileExpanded, setIsProfileExpanded] = useState(false);
  const [isNavigatorHidden, setIsNavigatorHidden] = useState(() => readPanelBool(UI_PANEL_KEYS.navigatorHidden, false));
  const [isInspectorHidden, setIsInspectorHidden] = useState(() => readPanelBool(UI_PANEL_KEYS.inspectorHidden, false));
  const [isProfileHidden, setIsProfileHidden] = useState(() => readPanelBool(UI_PANEL_KEYS.profileHidden, false));
  const [accessState, setAccessState] = useState<"checking" | "granted" | "readonly" | "pending" | "locked">("checking");
  const [accessDiagnosticMessage, setAccessDiagnosticMessage] = useState<string | null>(null);
  // Derived early so effects below can reference them without temporal dead zone.
  const lockedNeedsSignIn = isAuthSignInRequiredMessage(accessDiagnosticMessage);
  const isAnonymousGuestReadonly = accessState === "readonly" && !currentUser;
  const [activeUserId, setActiveUserId] = useState("");
  const [libraryAutoOpened, setLibraryAutoOpened] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareDirectory, setShareDirectory] = useState<CollaboratorDirectoryUser[]>([]);
  const [shareDirectoryBusy, setShareDirectoryBusy] = useState(false);
  const [shareSpecificUsers, setShareSpecificUsers] = useState<string[]>([]);
  const [shareSpecificRoles, setShareSpecificRoles] = useState<Record<string, "viewer" | "editor">>({});
  const [shareUserQuery, setShareUserQuery] = useState("");
  const [shareSpecificBusy, setShareSpecificBusy] = useState(false);
  const [shareSpecificStatus, setShareSpecificStatus] = useState("");
  const [appNotice, setAppNotice] = useState<AppNotice | null>(null);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileActivePanel, setMobileActivePanel] = useState<MobileWorkspacePanel>("navigator");
  const [mobileBottomPanelMode, setMobileBottomPanelMode] = useState<MobileBottomPanelMode>("normal");
  const [mobileControlsOccupied, setMobileControlsOccupied] = useState(0);
  const [localDevStatus, setLocalDevStatus] = useState<string | null>(null);
  const [offlineBannerDismissed, setOfflineBannerDismissed] = useState(false);
  const [showLibraryFromRequest, setShowLibraryFromRequest] = useState(false);
  const deepLinkAppliedRef = useRef(false);
  const deepLinkLoadFailedRef = useRef(false);
  const deepLinkApplyOutcomeRef = useRef<DeepLinkApplyOutcome>("idle");
  const cloudInitSeenRef = useRef(false);
  const cloudInitSettledRef = useRef(false);
  const appShellRef = useRef<HTMLElement | null>(null);
  const hadAuthenticatedSessionRef = useRef(false);
  const {
    showWelcomeModal,
    setShowWelcomeModal,
    showOnboardingTutorial,
    setShowOnboardingTutorial,
    closeWelcome,
    openOnboardingTutorial,
    openWelcomeFromWelcome,
    openLibraryFromWelcome,
    createNewFromWelcome,
  } = useOnboardingFlow({
    activeUserId,
    setShowSimulationLibraryRequest,
    setShowNewSimulationRequest,
  });

  const { theme, colorTheme, variant } = useThemeVariant();
  const basemapProvider = useAppStore((state) => state.basemapProvider);
  const basemapStylePreset = useAppStore((state) => state.basemapStylePreset);

  const resolvedBasemap = useMemo(
    () => resolveBasemapSelection(basemapProvider, basemapStylePreset, theme, colorTheme),
    [basemapProvider, basemapStylePreset, theme, colorTheme],
  );

  const runtimeEnvironment = getCurrentRuntimeEnvironment();
  const isLocalRuntime = runtimeEnvironment === "local";

  const deepLinkParse = useMemo(() => parseDeepLinkFromLocation(window.location), []);
  const activeSimulation = useMemo(
    () => simulationPresets.find((preset) => preset.id === selectedScenarioId) ?? null,
    [simulationPresets, selectedScenarioId],
  );
  const publishAppNotice = useCallback((notice: AppNotice) => {
    setAppNotice((current) => {
      if (current && current.id === notice.id && current.message === notice.message) {
        return current;
      }
      return notice;
    });
  }, []);
  const publishTransientNotice = useCallback(
    (id: string, message: string, tone: AppNotice["tone"] = "info") => {
      publishAppNotice({ id, message, tone, persistent: false });
    },
    [publishAppNotice],
  );
  const canPersistWorkspace =
    accessState === "granted" && (!activeSimulation || canEditResource(activeSimulation));
  const workspaceState = emptyWorkspaceState(sites.length, Boolean(activeSimulation));
  const mobileNavigatorTabId = "mobile-workspace-tab-navigator";
  const mobileInspectorTabId = "mobile-workspace-tab-inspector";
  const mobileProfileTabId = "mobile-workspace-tab-profile";
  const mobileNavigatorPanelId = "mobile-workspace-panel-navigator";
  const mobileInspectorPanelId = "mobile-workspace-panel-inspector";
  const mobileProfilePanelId = "mobile-workspace-panel-profile";
  const selectedLink = useMemo(
    () => links.find((link) => link.id === selectedLinkId) ?? null,
    [links, selectedLinkId],
  );
  const referencedPrivateSites = useMemo(() => {
    if (!activeSimulation || typeof activeSimulation !== "object") return [];
    const snapshotSites =
      (
        activeSimulation as {
          snapshot?: { sites?: Array<{ libraryEntryId?: string }> };
        }
      ).snapshot?.sites ?? [];
    const ids = new Set<string>();
    for (const site of snapshotSites) {
      if (!site || typeof site.libraryEntryId !== "string" || !site.libraryEntryId.trim()) continue;
      ids.add(site.libraryEntryId);
    }
    return siteLibrary.filter((site) => ids.has(site.id) && toVisibility(site.visibility) === "private");
  }, [activeSimulation, siteLibrary]);

  const currentShareLink = useMemo(() => {
    if (!activeSimulation) return "";
    const simulationSlug = activeSimulation.name;
    const selectedSites = selectedSiteIds
      .map((id) => sites.find((site) => site.id === id))
      .filter((site): site is NonNullable<typeof site> => Boolean(site));
    const selectedSiteIdSet = new Set(selectedSiteIds);

    let selectedLinkSlugs: string[] | undefined;
    let selectedSiteSlugs: string[] | undefined;

    const hasExplicitLinkSelection =
      Boolean(selectedLink) &&
      selectedSiteIds.length === 2 &&
      selectedLink !== null &&
      selectedSiteIdSet.has(selectedLink.fromSiteId) &&
      selectedSiteIdSet.has(selectedLink.toSiteId);

    if (hasExplicitLinkSelection && selectedLink) {
      selectedLinkSlugs = [selectedLink.fromSiteId, selectedLink.toSiteId]
        .map((id) => sites.find((s) => s.id === id)?.name)
        .filter((name): name is string => Boolean(name));
    } else if (selectedSites.length > 0) {
      selectedSiteSlugs = selectedSites.map((s) => s.name);
    }

    return buildDeepLinkUrl(
      {
        version: 2,
        simulationId: activeSimulation.id,
        simulationSlug,
        ...(selectedLinkSlugs ? { selectedLinkSlugs } : {}),
        ...(selectedSiteSlugs ? { selectedSiteSlugs } : {}),
      },
      window.location.origin,
      "/",
    );
  }, [activeSimulation, selectedLink, selectedSiteIds, sites]);

  useEffect(() => {
    if (
      !shouldRewritePathAfterDeepLinkApply({
        deepLinkApplied: deepLinkAppliedRef.current,
        deepLinkParseOk: deepLinkParse.ok,
        deepLinkApplyOutcome: deepLinkApplyOutcomeRef.current,
      })
    ) {
      return;
    }

    const reserved = ["api", "cdn-cgi", "assets", "meshmap"];
    const head = (window.location.pathname ?? "/").split("/").filter(Boolean)[0]?.toLowerCase() ?? "";
    if (reserved.includes(head)) return;

    const currentPath = window.location.pathname || "/";
    let targetPath = "/";

    if (currentShareLink) {
      try {
        targetPath = new URL(currentShareLink).pathname;
      } catch {
        return;
      }
    } else if (activeSimulation) {
      targetPath = buildDeepLinkPathname(activeSimulation.name, {
        selectedSiteSlugs: selectedSiteIds
          .map((id) => sites.find((site) => site.id === id)?.name)
          .filter((name): name is string => Boolean(name)),
      });
    }

    if (currentPath !== targetPath) {
      window.history.replaceState(null, "", targetPath);
    }
  }, [currentShareLink, activeSimulation, selectedSiteIds, sites, deepLinkParse.ok]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-light", "theme-dark");
    root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
    for (const [key, value] of Object.entries(variant.cssVars)) {
      root.style.setProperty(key, value);
    }
    root.style.colorScheme = theme;
  }, [theme, variant]);

  useEffect(() => {
    if (srtmTilesCount > 0) return;
    void recommendAndFetchTerrainForCurrentArea();
  }, [recommendAndFetchTerrainForCurrentArea, srtmTilesCount]);

  useEffect(() => {
    if (isInitializing) {
      console.log("[AppShell] Skipping sync - initialization in progress");
      return;
    }
    console.log("[AppShell] siteLibrary/simulationPresets/sites changed, calling performCloudSyncPush");
    console.log("[AppShell] siteLibrary length:", siteLibrary.length, "simulationPresets length:", simulationPresets.length, "sites length:", sites.length);
    void performCloudSyncPush();
  }, [performCloudSyncPush, isInitializing, siteLibrary, simulationPresets, sites]);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      void performCloudSyncPush();
    };
    const onOffline = () => {
      setIsOnline(false);
    };
    setIsOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [performCloudSyncPush, setIsOnline]);

  useEffect(() => {
    if (isOnline) {
      setOfflineBannerDismissed(false);
    }
  }, [isOnline]);

  useEffect(() => {
    let cancelled = false;
    let timedOut = false;
    setAuthState("checking");
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      timedOut = true;
      console.error("[AppShell] Access check timed out", {
        timeoutMs: ACCESS_CHECK_TIMEOUT_MS,
        isLocalRuntime,
        deepLinkMode: deepLinkParse.ok,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
        isInitializing,
      });
      setAccessDiagnosticMessage(
        "Access check timed out. Reload the page. If this continues, open the console and share the startup error.",
      );
      setCurrentUser(null);
      setAuthState("signed_out");
      setAccessState("locked");
    }, ACCESS_CHECK_TIMEOUT_MS);

    console.info("[AppShell] Starting access check", {
      isLocalRuntime,
      deepLinkMode: deepLinkParse.ok,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
      isInitializing,
    });

    void (async () => {
      try {
        if (cancelled || timedOut) return;
        const localForceReadonly =
          isLocalRuntime &&
          (() => {
            try {
              return localStorage.getItem(LOCAL_FORCE_READONLY_KEY) === "1";
            } catch {
              return false;
            }
          })();
        if (localForceReadonly) {
          if (cancelled || timedOut) return;
          window.clearTimeout(timeoutId);
          setAccessDiagnosticMessage(null);
          setCurrentUser(null);
          setAuthState("signed_out");
          setAccessState("readonly");
          return;
        }
        if (deepLinkParse.ok && !isLocalRuntime) {
          const deepLinkStatus = await fetchDeepLinkStatus({
            simulationId: deepLinkParse.payload.simulationId,
            simulationSlug: deepLinkParse.payload.simulationSlug,
          });
          if (!deepLinkStatus.authenticated) {
            if (cancelled || timedOut) return;
            window.clearTimeout(timeoutId);
            setAccessDiagnosticMessage(null);
            setCurrentUser(null);
            setAuthState("signed_out");
            setAccessState("readonly");
            return;
          }
        }
        const profile = await fetchMe();
        if (cancelled || timedOut) return;
        window.clearTimeout(timeoutId);
        setAccessDiagnosticMessage(null);
        setCurrentUser(profile);
        setAuthState("signed_in");
        hadAuthenticatedSessionRef.current = true;
        setActiveUserId(profile.id);
        try {
          const seen = localStorage.getItem(`${ONBOARDING_SEEN_KEY_PREFIX}${profile.id}`);
          if (!seen && !deepLinkParse.ok) {
            setShowWelcomeModal(true);
          }
        } catch {
          // ignore storage errors
        }
        if (profile.accountState === "revoked") {
          setAccessState("locked");
          return;
        }
        if (profile.isAdmin || profile.isModerator || profile.isApproved) {
          setAccessState("granted");
          return;
        }
        if (deepLinkParse.ok) {
          setAccessState("readonly");
          return;
        }
        setAccessState("pending");
      } catch (error) {
        if (cancelled || timedOut) return;
        window.clearTimeout(timeoutId);
        const message = getUiErrorMessage(error);
        const isOnlineNow = typeof navigator === "undefined" ? true : navigator.onLine;
        const fallbackToReadonly = shouldUseReadonlyFallbackForAuthBootstrap({
          message,
          deepLinkMode: deepLinkParse.ok,
          isLocalRuntime,
          isOnline: isOnlineNow,
          userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
        });
        if (deepLinkParse.ok) {
          console.info("[AppShell] Guest deep-link bootstrap using read-only fallback", {
            message,
            isLocalRuntime,
            deepLinkMode: deepLinkParse.ok,
            online: isOnlineNow,
          });
        } else {
          console.error("[AppShell] Access check failed", {
            message,
            isLocalRuntime,
            deepLinkMode: deepLinkParse.ok,
            online: isOnlineNow,
            fallbackToReadonly,
          });
        }
        setAccessDiagnosticMessage(`Access check failed: ${message}`);
        const hadAuthenticatedSession = hadAuthenticatedSessionRef.current;
        if (hadAuthenticatedSession) {
          setCurrentUser(null);
          setAuthState("signed_out");
        }
        if (message.includes("Session revoked by admin")) {
          window.location.href = "/cdn-cgi/access/logout";
          return;
        }
        if (deepLinkParse.ok) {
          setAccessState("readonly");
          return;
        }
        if (fallbackToReadonly) {
          if (hadAuthenticatedSession) {
            setAccessDiagnosticMessage("You are signed out. Sign in to continue.");
            setAccessState("locked");
          } else {
            setAccessDiagnosticMessage("Sign-in check was blocked by browser auth redirects. Continuing in read-only demo mode.");
            setAccessState("readonly");
          }
          return;
        }
        if (isAuthSignInRequiredMessage(message)) {
          if (hadAuthenticatedSession) {
            setAccessDiagnosticMessage("You are signed out. Sign in to continue.");
            setAccessState("locked");
          } else {
            setAccessState("readonly");
          }
          return;
        }
        setAccessState("locked");
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [deepLinkParse, isLocalRuntime, isInitializing, setAuthState, setCurrentUser]);

  useEffect(() => {
    if (authState !== "signed_out") return;
    if (accessState === "checking") return;
    if (!hadAuthenticatedSessionRef.current) return;
    setAccessDiagnosticMessage("You are signed out. Sign in to continue.");
    setAccessState("locked");
  }, [accessState, authState]);

  useEffect(() => {
    if (accessState === "granted") {
      console.log("[AppShell] Access granted, running migrations and initializing cloud sync...");
      void runMigrations().then(() => initializeCloudSync());
    }
  }, [accessState, initializeCloudSync]);

  // Auto-load the Oslo demo workspace for anonymous visitors with no deeplink,
  // and publish a persistent map notice (uses the existing map-inline-notice UI).
  useEffect(() => {
    const isAnonNoDeepLink = !deepLinkParse.ok && isAnonymousGuestReadonly;
    if (!isAnonNoDeepLink) return;
    if (sites.length === 0) {
      loadDemoScenario();
    }
    publishAppNotice({
      id: "demo-mode",
      message: deepLinkParse.ok ? "Viewing as guest." : "Demo workspace — sign in to save your own simulations.",
      tone: "info",
      persistent: true,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnonymousGuestReadonly, deepLinkParse.ok]);

  const signOutOrReadonly = useCallback(() => {
    setCurrentUser(null);
    setAuthState("signed_out");
    hadAuthenticatedSessionRef.current = true;
    if (isLocalRuntime) {
      try {
        localStorage.setItem(LOCAL_FORCE_READONLY_KEY, "1");
      } catch {
        // ignore storage errors
      }
      window.location.reload();
      return;
    }
    if (deepLinkParse.ok) {
      window.location.reload();
      return;
    }
    window.location.href = "/cdn-cgi/access/logout";
  }, [deepLinkParse.ok, isLocalRuntime, setAuthState, setCurrentUser]);

  const signIn = useCallback(() => {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.href = `/api/auth-start?returnTo=${encodeURIComponent(returnTo || "/")}`;
  }, []);

  const signIn = useCallback(() => {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.href = `/api/auth-start?returnTo=${encodeURIComponent(returnTo || "/")}`;
  }, []);

  const switchLocalRole = useCallback(
    async (role: "admin" | "moderator" | "user" | "pending") => {
      try {
        setLocalDevStatus(`Switching local role to ${role}...`);
        await setLocalDevRole(role);
        try {
          localStorage.removeItem(LOCAL_FORCE_READONLY_KEY);
        } catch {
          // ignore storage errors
        }
        window.location.reload();
      } catch (error) {
        const message = getUiErrorMessage(error);
        setLocalDevStatus(`Local role switch failed: ${message}`);
        publishAppNotice({
          id: "local-role-switch-failed",
          message: `Local role switch failed: ${message}`,
          tone: "error",
          persistent: true,
        });
      }
    },
    [publishAppNotice],
  );

  useEffect(() => {
    if (!appNotice || appNotice.persistent) return;
    const timer = window.setTimeout(() => setAppNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [appNotice]);

  useEffect(() => {
    try { localStorage.setItem(UI_PANEL_KEYS.navigatorHidden, String(isNavigatorHidden)); } catch {}
  }, [isNavigatorHidden]);

  useEffect(() => {
    try { localStorage.setItem(UI_PANEL_KEYS.inspectorHidden, String(isInspectorHidden)); } catch {}
  }, [isInspectorHidden]);

  useEffect(() => {
    try { localStorage.setItem(UI_PANEL_KEYS.profileHidden, String(isProfileHidden)); } catch {}
  }, [isProfileHidden]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 980px)");
    const applyViewport = () => setIsMobileViewport(mediaQuery.matches);
    applyViewport();
    mediaQuery.addEventListener("change", applyViewport);
    return () => mediaQuery.removeEventListener("change", applyViewport);
  }, []);

  useEffect(() => {
    if (!isMobileViewport) {
      setMobileControlsOccupied(0);
      return;
    }

    const shell = appShellRef.current;
    if (!shell) return;

    let frameId = 0;

    const measureHeight = (selector: string) => {
      const element = shell.querySelector<HTMLElement>(selector);
      if (!element) return 0;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return 0;
      return Math.ceil(element.getBoundingClientRect().height);
    };

    const recompute = () => {
      const controlsHeight = measureHeight(".map-controls");
      setMobileControlsOccupied((current) => (current === controlsHeight ? current : controlsHeight));
    };

    const schedule = () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      frameId = window.requestAnimationFrame(recompute);
    };

    schedule();
    const followUpTimerA = window.setTimeout(schedule, 120);
    const followUpTimerB = window.setTimeout(schedule, 280);

    const observer = new ResizeObserver(schedule);
    observer.observe(shell);
    shell.querySelectorAll<HTMLElement>(".map-controls, .map-controls *").forEach((element) => {
      observer.observe(element);
    });
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      window.clearTimeout(followUpTimerA);
      window.clearTimeout(followUpTimerB);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, [isMobileViewport, isMapExpanded, isProfileExpanded, mobileActivePanel, mobileBottomPanelMode]);

  useEffect(() => {
    if (isInitializing) {
      cloudInitSeenRef.current = true;
      return;
    }
    if (cloudInitSeenRef.current) {
      cloudInitSettledRef.current = true;
    }
  }, [isInitializing]);

  useEffect(() => {
    if (
      !canRunDeepLinkApply({
        accessState,
        deepLinkAlreadyApplied: deepLinkAppliedRef.current,
        isInitializing,
        cloudInitSettled: cloudInitSettledRef.current,
      })
    ) {
      return;
    }
    if (!deepLinkParse.ok) {
      deepLinkLoadFailedRef.current = deepLinkParse.reason !== "missing_sim";
      deepLinkApplyOutcomeRef.current = deepLinkParse.reason === "missing_sim" ? "idle" : "failed";
      if (deepLinkParse.reason !== "missing_sim") {
        publishAppNotice({
          id: "invalid-deep-link",
          message:
            deepLinkParse.reason === "invalid_version"
              ? "Unsupported deep-link format."
              : deepLinkParse.reason === "invalid_slug"
                ? "The shared link path is invalid."
                : "The shared link is missing a valid simulation id.",
          tone: "warning",
          persistent: true,
        });
      }
      deepLinkAppliedRef.current = true;
      return;
    }

    void (async () => {
      deepLinkLoadFailedRef.current = false;
      deepLinkApplyOutcomeRef.current = "idle";
      const payload = deepLinkParse.payload;
      const markDeepLinkFailed = () => {
        deepLinkLoadFailedRef.current = true;
        deepLinkApplyOutcomeRef.current = "failed";
        deepLinkAppliedRef.current = true;
      };
      const safeDecode = (value: string): string => {
        try {
          return decodeURIComponent(value);
        } catch {
          return value;
        }
      };
      let resolvedSimulationId = payload.simulationId ?? "";
      const resolveBySlug = (): string | undefined => {
        const decodedSlug = safeDecode(payload.simulationSlug ?? "");
        const targetPretty = slugifyName(decodedSlug);
        const targetCanonical = canonicalizeDeepLinkKey(decodedSlug);
        if (!targetPretty && !targetCanonical) return undefined;
        const bySlug = useAppStore
          .getState()
          .simulationPresets.find((preset) => {
            const presetSlugRaw = typeof (preset as { slug?: unknown }).slug === "string" ? String((preset as { slug?: unknown }).slug) : "";
            const presetSlugValue = presetSlugRaw.trim() ? presetSlugRaw : preset.name;
            const presetPretty = slugifyName(presetSlugValue);
            const presetCanonical = canonicalizeDeepLinkKey(presetSlugValue);
            if ((targetPretty && presetPretty === targetPretty) || (targetCanonical && presetCanonical === targetCanonical)) {
              return true;
            }
            const aliases = Array.isArray((preset as { slugAliases?: unknown }).slugAliases)
              ? ((preset as { slugAliases?: string[] }).slugAliases ?? [])
              : [];
            return aliases.some((alias) => {
              const aliasPretty = slugifyName(alias);
              const aliasCanonical = canonicalizeDeepLinkKey(alias);
              return (targetPretty && aliasPretty === targetPretty) || (targetCanonical && aliasCanonical === targetCanonical);
            });
          })
          ?.id;
        return bySlug;
      };
      if (!resolvedSimulationId) {
        resolvedSimulationId = resolveBySlug() ?? "";
      }
      let state = useAppStore.getState();
      let exists = resolvedSimulationId
        ? state.simulationPresets.some((preset) => preset.id === resolvedSimulationId)
        : Boolean(resolveBySlug());

      if (!exists && accessState === "granted") {
        try {
          const cloud = await fetchCloudLibrary();
          importLibraryData(
            {
              siteLibrary: cloud.siteLibrary as Parameters<typeof importLibraryData>[0]["siteLibrary"],
              simulationPresets: cloud.simulationPresets as Parameters<typeof importLibraryData>[0]["simulationPresets"],
            },
            "merge",
          );
          state = useAppStore.getState();
          if (!resolvedSimulationId) resolvedSimulationId = resolveBySlug() ?? "";
          exists = resolvedSimulationId
            ? state.simulationPresets.some((preset) => preset.id === resolvedSimulationId)
            : Boolean(resolveBySlug());
        } catch {
          // Keep checking through status endpoint below.
        }
      }

      if (!exists && accessState === "readonly") {
        try {
          const publicBundle = await fetchPublicSimulationLibrary({
            simulationId: resolvedSimulationId || undefined,
            simulationSlug: payload.simulationSlug,
          });
          importLibraryData(
            {
              siteLibrary: publicBundle.siteLibrary as Parameters<typeof importLibraryData>[0]["siteLibrary"],
              simulationPresets: publicBundle.simulationPresets as Parameters<typeof importLibraryData>[0]["simulationPresets"],
            },
            "merge",
          );
          resolvedSimulationId = publicBundle.simulationId ?? resolvedSimulationId;
          exists = Boolean(resolvedSimulationId);
        } catch {
          markDeepLinkFailed();
          publishAppNotice({
            id: "shared-simulation-unavailable",
            message: "This shared simulation is unavailable.",
            tone: "error",
            persistent: true,
          });
          return;
        }
      }

      if (!exists && accessState !== "readonly") {
        try {
          const status = await fetchDeepLinkStatus({
            simulationId: resolvedSimulationId || undefined,
            simulationSlug: payload.simulationSlug,
          });
          if (status.status === "forbidden") {
            markDeepLinkFailed();
            publishAppNotice({
              id: "shared-simulation-forbidden",
              message: "You do not have access to this shared simulation.",
              tone: "warning",
              persistent: true,
            });
            return;
          }
          if (status.status === "missing") {
            markDeepLinkFailed();
            publishAppNotice({
              id: "shared-simulation-missing",
              message: "This shared simulation no longer exists.",
              tone: "warning",
              persistent: true,
            });
            return;
          }
          if (status.simulationId) {
            resolvedSimulationId = status.simulationId;
          }
        } catch {
          // Ignore and use generic message.
        }
      }

      if (!exists && accessState !== "readonly") {
        try {
          const status = await fetchDeepLinkStatus({
            simulationId: resolvedSimulationId || undefined,
            simulationSlug: payload.simulationSlug,
          });
          if (status.status === "forbidden") {
            markDeepLinkFailed();
            publishAppNotice({
              id: "shared-simulation-forbidden",
              message: "You do not have access to this shared simulation.",
              tone: "warning",
              persistent: true,
            });
            return;
          }
          if (status.status === "missing") {
            markDeepLinkFailed();
            publishAppNotice({
              id: "shared-simulation-missing",
              message: "This shared simulation no longer exists.",
              tone: "warning",
              persistent: true,
            });
            return;
          }
          if (status.simulationId) {
            resolvedSimulationId = status.simulationId;
          }
        } catch {
          // Ignore and use generic message.
        }
        publishAppNotice({
          id: "shared-simulation-unavailable",
          message: "This shared simulation is unavailable.",
          tone: "error",
          persistent: true,
        });
        markDeepLinkFailed();
        return;
      }

      if (!resolvedSimulationId) {
        markDeepLinkFailed();
        publishAppNotice({
          id: "shared-simulation-unavailable",
          message: "This shared simulation is unavailable.",
          tone: "error",
          persistent: true,
        });
        return;
      }
      loadSimulationPreset(resolvedSimulationId);
      deepLinkLoadFailedRef.current = false;
      deepLinkApplyOutcomeRef.current = "succeeded";
      const latest = useAppStore.getState();
      const decodedLinkSlugs = payload.selectedLinkSlugs?.map(safeDecode);
      const decodedSiteSlugs = payload.selectedSiteSlugs?.map(safeDecode);
      const normalizeForMatch = (value: string): string => slugifyName(value).normalize("NFKC");
      const normalizeExact = (value: string): string => safeDecode(value).trim().normalize("NFKC").replace(/[\uFE0E\uFE0F]/g, "");
      if (decodedLinkSlugs && decodedLinkSlugs.length === 2) {
        const [fromSlug, toSlug] = decodedLinkSlugs;
        const fromExact = normalizeExact(fromSlug);
        const toExact = normalizeExact(toSlug);
        const fromPretty = normalizeForMatch(fromSlug);
        const toPretty = normalizeForMatch(toSlug);
        const fromCanonical = canonicalizeDeepLinkKey(fromSlug);
        const toCanonical = canonicalizeDeepLinkKey(toSlug);
        const bySlug = latest.links.find(
          (link) => {
            const fromName = latest.sites.find((s) => s.id === link.fromSiteId)?.name ?? "";
            const toName = latest.sites.find((s) => s.id === link.toSiteId)?.name ?? "";
            const fromNameExact = normalizeExact(fromName);
            const toNameExact = normalizeExact(toName);
            const fromNamePretty = normalizeForMatch(fromName);
            const toNamePretty = normalizeForMatch(toName);
            const fromNameCanonical = canonicalizeDeepLinkKey(fromName);
            const toNameCanonical = canonicalizeDeepLinkKey(toName);
            return (
              ((fromExact && fromNameExact === fromExact) ||
                (fromPretty && fromNamePretty === fromPretty) ||
                (fromCanonical && fromNameCanonical === fromCanonical)) &&
              ((toExact && toNameExact === toExact) ||
                (toPretty && toNamePretty === toPretty) ||
                (toCanonical && toNameCanonical === toCanonical))
            );
          },
        );
        if (bySlug) {
          setSelectedLinkId(bySlug.id);
        } else {
          clearActiveSelection();
          publishAppNotice({
            id: "shared-link-selection-unresolved",
            message: "Could not resolve link selection from this deep link.",
            tone: "warning",
            persistent: true,
          });
        }
      } else if (decodedSiteSlugs && decodedSiteSlugs.length > 0) {
        const matchedSiteIds: string[] = [];
        for (const siteSlug of decodedSiteSlugs) {
          const siteExact = normalizeExact(siteSlug);
          const sitePretty = normalizeForMatch(siteSlug);
          const siteCanonical = canonicalizeDeepLinkKey(siteSlug);
          const site = latest.sites.find((s) => {
            const candidateExact = normalizeExact(s.name);
            const candidatePretty = normalizeForMatch(s.name);
            const candidateCanonical = canonicalizeDeepLinkKey(s.name);
            return (
              (siteExact && candidateExact === siteExact) ||
              (sitePretty && candidatePretty === sitePretty) ||
              (siteCanonical && candidateCanonical === siteCanonical)
            );
          });
          if (site && !matchedSiteIds.includes(site.id)) matchedSiteIds.push(site.id);
        }
        if (matchedSiteIds.length === decodedSiteSlugs.length && matchedSiteIds.length > 0) {
          clearActiveSelection();
          const [firstSiteId, ...remainingSiteIds] = matchedSiteIds;
          if (firstSiteId) setSelectedSiteId(firstSiteId);
          for (const siteId of remainingSiteIds) {
            selectSiteById(siteId, true);
          }
        } else {
          clearActiveSelection();
          publishAppNotice({
            id: "shared-site-selection-unresolved",
            message: "Could not resolve all site selections from this deep link.",
            tone: "warning",
            persistent: true,
          });
        }
      }
      deepLinkAppliedRef.current = true;
    })();
  }, [
    accessState,
    deepLinkParse,
    importLibraryData,
    isInitializing,
    loadSimulationPreset,
    clearActiveSelection,
    simulationPresets,
    setMapOverlayMode,
    setSelectedSiteId,
    setSelectedLinkId,
    updateMapViewport,
    publishAppNotice,
  ]);

  useEffect(() => {
    if (libraryAutoOpened) return;
    if (workspaceState !== "no-simulation") return;
    if (showWelcomeModal) return;
    if (accessState !== "granted" && accessState !== "readonly") return;
    if (!activeUserId) return;
    try {
      const seen = localStorage.getItem(`${ONBOARDING_SEEN_KEY_PREFIX}${activeUserId}`);
      if (!seen) return;
    } catch {
      return;
    }
    setLibraryAutoOpened(true);
    setShowSimulationLibraryRequest(true);
  }, [libraryAutoOpened, workspaceState, showWelcomeModal, accessState, activeUserId, setShowSimulationLibraryRequest]);

  useEffect(() => {
    if (!showSimulationLibraryRequest) return;
    setShowSimulationLibraryRequest(false);
    setShowLibraryFromRequest(true);
  }, [showSimulationLibraryRequest, setShowSimulationLibraryRequest]);

  const openOnboardingTutorial = () => {
    setShowOnboardingTutorial(true);
  };

  const openWelcomeFromWelcome = () => {
    setShowWelcomeModal(false);
    setShowOnboardingTutorial(true);
  };

  const openLibraryFromWelcome = () => {
    setShowWelcomeModal(false);
    setShowSimulationLibraryRequest(true);
    try {
      if (activeUserId) localStorage.setItem(`${ONBOARDING_SEEN_KEY_PREFIX}${activeUserId}`, "1");
    } catch {
      // ignore
    }
  };

  const createNewFromWelcome = () => {
    setShowWelcomeModal(false);
    setShowNewSimulationRequest(true);
    try {
      if (activeUserId) localStorage.setItem(`${ONBOARDING_SEEN_KEY_PREFIX}${activeUserId}`, "1");
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (libraryAutoOpened) return;
    if (workspaceState !== "no-simulation") return;
    if (showWelcomeModal) return;
    if (accessState !== "granted" && accessState !== "readonly") return;
    if (!activeUserId) return;
    try {
      const seen = localStorage.getItem(`${ONBOARDING_SEEN_KEY_PREFIX}${activeUserId}`);
      if (!seen) return;
    } catch {
      return;
    }
    setLibraryAutoOpened(true);
    setShowSimulationLibraryRequest(true);
  }, [libraryAutoOpened, workspaceState, showWelcomeModal, accessState, activeUserId, setShowSimulationLibraryRequest]);

  useEffect(() => {
    if (!showSimulationLibraryRequest) return;
    setShowSimulationLibraryRequest(false);
    setShowLibraryFromRequest(true);
  }, [showSimulationLibraryRequest, setShowSimulationLibraryRequest]);

  const copyCurrentLink = useCallback(async () => {
    if (!activeSimulation) {
      publishAppNotice({
        id: "share-open-simulation-first",
        message: "Open a saved simulation first. Unsaved workspace state cannot be shared as a deep link.",
        tone: "warning",
        persistent: true,
      });
      return;
    }
    if (!currentShareLink) {
      publishAppNotice({
        id: "share-link-build-failed",
        message: "Unable to build share link for this simulation.",
        tone: "error",
        persistent: true,
      });
      return;
    }
    await copyToClipboard(currentShareLink);
    publishTransientNotice("share-link-copied", "Share link copied.");
  }, [activeSimulation, currentShareLink, publishAppNotice, publishTransientNotice]);

  const runUpgradeAndShare = useCallback(async () => {
    if (!activeSimulation || !currentUser) {
      publishAppNotice({
        id: "share-no-active-simulation",
        message: "No active saved simulation.",
        tone: "warning",
        persistent: true,
      });
      return;
    }
    if (!canEditResource(activeSimulation)) {
      publishAppNotice({
        id: "share-no-edit-access-simulation",
        message: "You do not have edit access to this simulation.",
        tone: "warning",
        persistent: true,
      });
      return;
    }
    const blockedSites = referencedPrivateSites.filter((site) => !canEditResource(site));
    if (blockedSites.length) {
      publishAppNotice({
        id: "share-no-edit-access-sites",
        message: `Cannot upgrade ${blockedSites.length} private site(s) because you do not have edit access to them.`,
        tone: "warning",
        persistent: true,
      });
      return;
    }

    setShareBusy(true);

    // Start clipboard write within gesture context; content resolves after save.
    let resolveUpgradeLink!: (t: string) => void;
    let rejectUpgradeLink!: (e: unknown) => void;
    const upgradeLinkPromise = new Promise<string>((res, rej) => { resolveUpgradeLink = res; rejectUpgradeLink = rej; });
    const upgradeClipboardDone = copyToClipboard(upgradeLinkPromise);

    try {
      for (const site of referencedPrivateSites) {
        updateSiteLibraryEntry(site.id, { visibility: "shared" });
      }
      updateSimulationPresetEntry(activeSimulation.id, { visibility: "shared" });

      const latest = useAppStore.getState();
      const latestSimulation = latest.simulationPresets.find((preset) => preset.id === activeSimulation.id);
      const latestSites = latest.siteLibrary.filter((site) =>
        referencedPrivateSites.some((candidate) => candidate.id === site.id),
      );
      if (!latestSimulation) throw new Error("Simulation missing after local update.");

      await pushCloudLibrary({
        simulationPresets: [latestSimulation],
        siteLibrary: latestSites,
      });

      resolveUpgradeLink(currentShareLink);
      await upgradeClipboardDone;
      publishTransientNotice("share-upgrade-complete", "Simulation and referenced sites are now Shared. Link copied.");
    } catch (error) {
      rejectUpgradeLink(error);
      publishAppNotice({
        id: "share-upgrade-failed",
        message: `Upgrade failed: ${getUiErrorMessage(error)}`,
        tone: "error",
        persistent: true,
      });
    } finally {
      setShareBusy(false);
    }
  }, [
    activeSimulation,
    currentShareLink,
    currentUser,
    publishAppNotice,
    publishTransientNotice,
    referencedPrivateSites,
    updateSimulationPresetEntry,
    updateSiteLibraryEntry,
  ]);

  const runShareWithSpecificUsers = useCallback(async () => {
    if (!activeSimulation || !currentUser) return;
    if (toVisibility(activeSimulation.visibility) !== "private" && referencedPrivateSites.length) {
      setShareSpecificStatus(
        formatPrivateSiteReferenceBlockMessage(referencedPrivateSites.map((site) => site.name)),
      );
      return;
    }
    if (!shareSpecificUsers.length) {
      setShareSpecificStatus("Add at least one user first.");
      return;
    }
    setShareSpecificBusy(true);
    setShareSpecificStatus("");

    // Resolve the link text deferred so clipboard write starts within this gesture context.
    let resolveLink!: (t: string) => void;
    let rejectLink!: (e: unknown) => void;
    const linkPromise = new Promise<string>((res, rej) => { resolveLink = res; rejectLink = rej; });
    const clipboardDone = copyToClipboard(linkPromise);

    try {
      const existingGrants = (activeSimulation.sharedWith ?? []) as Array<{ userId: string; role: string }>;
      const existingIds = new Set(existingGrants.map((g) => g.userId));
      const newGrants = shareSpecificUsers
        .filter((id) => !existingIds.has(id))
        .map((id) => ({ userId: id, role: shareSpecificRoles[id] ?? "viewer" }));
      const mergedGrants = [
        ...existingGrants.map((g) => ({ userId: g.userId, role: (shareSpecificRoles[g.userId] ?? g.role) as "viewer" | "editor" })),
        ...newGrants,
      ];
      updateSimulationPresetEntry(activeSimulation.id, { sharedWith: mergedGrants });
      const latest = useAppStore.getState();
      const latestSimulation = latest.simulationPresets.find((p) => p.id === activeSimulation.id);
      if (!latestSimulation) throw new Error("Simulation missing after local update.");
      await pushCloudLibrary({ simulationPresets: [latestSimulation], siteLibrary: [] });
      resolveLink(currentShareLink);
      await clipboardDone;
      setShareSpecificStatus("Collaborators saved. Link copied — share it with the users you added.");
    } catch (error) {
      rejectLink(error);
      setShareSpecificStatus(`Failed: ${getUiErrorMessage(error)}`);
    } finally {
      setShareSpecificBusy(false);
    }
  }, [
    activeSimulation,
    currentShareLink,
    currentUser,
    referencedPrivateSites,
    shareSpecificRoles,
    shareSpecificUsers,
    updateSimulationPresetEntry,
  ]);

  const shellStyle = useMemo<CSSProperties | undefined>(() => {
    const style: CSSProperties = {
      ["--sidebar-overlay-width" as string]:
        isNavigatorHidden && !isMapExpanded && !isProfileExpanded ? "0px" : "clamp(280px, 20vw, 400px)",
      ["--inspector-overlay-width" as string]:
        isInspectorHidden || isMapExpanded || isProfileExpanded ? "0px" : "clamp(280px, 20vw, 400px)",
    };
    if (!isMobileViewport) return style;
    return {
      ...style,
      ["--mobile-controls-occupied" as string]: `${mobileControlsOccupied}px`,
    };
  }, [
    isInspectorHidden,
    isMapExpanded,
    isMobileViewport,
    isNavigatorHidden,
    isProfileExpanded,
    mobileControlsOccupied,
  ]);
  const isAnonymousBootstrapShell = accessState === "checking";
  const isReadOnlyShell = isAnonymousGuestReadonly || isAnonymousBootstrapShell;

  const toggleProfileExpanded = () => {
    setIsMapExpanded(false);
    setMobileActivePanel("profile");
    setIsProfileExpanded((prev) => !prev);
  };

  const setMobileBottomPanelVisibility = useCallback((nextMode: MobileBottomPanelMode) => {
    setMobileBottomPanelMode(nextMode);
  }, []);

  const closeShareModal = useCallback(() => {
    setShowShareModal(false);
    setShareSpecificUsers([]);
    setShareSpecificRoles({});
    setShareUserQuery("");
    setShareSpecificStatus("");
  }, []);

  const openShareModalOrCopy = useCallback(() => {
    setAppNotice(null);
    if (!activeSimulation) {
      publishAppNotice({
        id: "share-open-simulation-first",
        message: "Open a saved simulation first. Unsaved workspace state cannot be shared as a deep link.",
        tone: "warning",
        persistent: true,
      });
      return;
    }
    if (toVisibility(activeSimulation.visibility) === "private") {
      setShareSpecificUsers([]);
      setShareSpecificRoles({});
      setShareUserQuery("");
      setShareSpecificStatus("");
      setShareDirectory([]);
      setShareDirectoryBusy(true);
      setShowShareModal(true);
      void fetchCollaboratorDirectory()
        .then((users) => setShareDirectory(users))
        .catch(() => {})
        .finally(() => setShareDirectoryBusy(false));
      return;
    }
    void copyCurrentLink().catch((error) => {
      publishAppNotice({
        id: "share-copy-failed",
        message: getUiErrorMessage(error),
        tone: "error",
        persistent: true,
      });
    });
  }, [activeSimulation, copyCurrentLink, publishAppNotice]);

  const panelSizeControls = useCallback(
    (labelPrefix: string, variant: "map" | "chart" = "map") => (
      <div className="panel-size-controls">
        {mobileBottomPanelMode === "full" ? (
          <button
            aria-label={`Set ${labelPrefix} panel to normal size`}
            className={variant === "chart" ? "chart-endpoint-swap chart-endpoint-icon" : "map-control-btn map-control-btn-icon"}
            onClick={() => setMobileBottomPanelVisibility("normal")}
            title="Normal size"
            type="button"
          >
            <PanelBottom aria-hidden="true" strokeWidth={1.8} />
          </button>
        ) : (
          <>
            <button
              aria-label={`Hide ${labelPrefix} panel`}
              className={variant === "chart" ? "chart-endpoint-swap chart-endpoint-icon" : "map-control-btn map-control-btn-icon"}
              onClick={() => setMobileBottomPanelVisibility("hidden")}
              title="Hide panel"
              type="button"
            >
              <PanelBottomClose aria-hidden="true" strokeWidth={1.8} />
            </button>
            <button
              aria-label={`Expand ${labelPrefix} panel to full height`}
              className={variant === "chart" ? "chart-endpoint-swap chart-endpoint-icon" : "map-control-btn map-control-btn-icon"}
              onClick={() => setMobileBottomPanelVisibility("full")}
              title="Full size"
              type="button"
            >
              <Maximize2 aria-hidden="true" strokeWidth={1.8} />
            </button>
          </>
        )}
      </div>
    ),
    [mobileBottomPanelMode, setMobileBottomPanelVisibility],
  );

  if (accessState === "pending") {
    return (
      <main className="app-shell access-locked-shell">
        <section className="panel-section access-locked-panel">
          <UserAdminPanel />
          <h2>Closed Beta: Access Pending Approval</h2>
          <p className="field-help">
            You can sign in and edit your profile, but simulation tools stay locked until a moderator or admin approves your access.
          </p>
          <p className="field-help">LinkSim is currently invite/approval-only while we run a closed beta.</p>
          <p className="field-help">To continue:</p>
          <ul className="field-help access-pending-list">
            <li>Open User Settings.</li>
            <li>Add your name and valid email address.</li>
            <li>Optionally add an access request note to explain why you need access.</li>
            <li>Wait for moderator/admin approval. You will keep profile access while pending.</li>
          </ul>
          {isLocalRuntime ? (
            <div className="chip-group">
              <button className="inline-action" onClick={() => void switchLocalRole("admin")} type="button">
                Use Admin (Local)
              </button>
              <button className="inline-action" onClick={() => void switchLocalRole("moderator")} type="button">
                Use Moderator (Local)
              </button>
              <button className="inline-action" onClick={() => void switchLocalRole("user")} type="button">
                Use User (Local)
              </button>
              <button className="inline-action" onClick={() => void switchLocalRole("pending")} type="button">
                Use Pending (Local)
              </button>
            </div>
          ) : null}
           {localDevStatus ? <p className="field-help">{localDevStatus}</p> : null}
        </section>
        <WelcomeModal onClose={closeWelcome} onCreateNewSimulation={createNewFromWelcome} onOpenLibrary={openLibraryFromWelcome} onOpenOnboarding={openWelcomeFromWelcome} open={showWelcomeModal} />
        <OnboardingTutorialModal onClose={() => setShowOnboardingTutorial(false)} onOpenLibrary={() => setShowSimulationLibraryRequest(true)} onOpenSiteLibrary={() => setShowSiteLibraryRequest(true)} open={showOnboardingTutorial} />
      </main>
    );
  }

  if (accessState === "locked") {
    const shouldPromptSignIn = lockedNeedsSignIn || authState === "signed_out";
    return (
      <main className="app-shell access-locked-shell">
        <section className="panel-section access-locked-panel">
          {shouldPromptSignIn ? (
            <div className="access-locked-alert-icon sync-error" aria-hidden="true">
              <CloudAlert strokeWidth={1.8} />
            </div>
          ) : null}
          <h2>{shouldPromptSignIn ? "Signed out" : "Access unavailable"}</h2>
          {accessDiagnosticMessage ? <p className="field-help">{accessDiagnosticMessage}</p> : null}
          {shouldPromptSignIn ? (
            <p className="field-help">Sign in again to continue where you left off.</p>
          ) : (
            <>
              <p className="field-help">
                Your account session is valid, but this account is not available in LinkSim right now.
              </p>
              <p className="field-help">
                If your user was removed by an admin, ask for re-approval. Then sign out and sign in again.
              </p>
            </>
          )}
          <div className="chip-group">
          {shouldPromptSignIn ? (
              <>
                <button className="inline-action" onClick={signIn} type="button">
                  <CircleUserRound aria-hidden="true" strokeWidth={1.8} />
                  <span>Sign In</span>
                </button>
              </>
            ) : (
              <button className="inline-action" onClick={signOutOrReadonly} type="button">
                Sign Out
              </button>
            )}
            {isLocalRuntime ? (
              <>
                <button className="inline-action" onClick={() => void switchLocalRole("admin")} type="button">
                  Use Admin (Local)
                </button>
                <button className="inline-action" onClick={() => void switchLocalRole("moderator")} type="button">
                  Use Moderator (Local)
                </button>
                <button className="inline-action" onClick={() => void switchLocalRole("user")} type="button">
                  Use User (Local)
                </button>
                <button className="inline-action" onClick={() => void switchLocalRole("pending")} type="button">
                  Use Pending (Local)
                </button>
              </>
            ) : null}
          </div>
          {localDevStatus ? <p className="field-help">{localDevStatus}</p> : null}
        </section>
        <WelcomeModal onClose={closeWelcome} onCreateNewSimulation={createNewFromWelcome} onOpenLibrary={openLibraryFromWelcome} onOpenOnboarding={openWelcomeFromWelcome} open={showWelcomeModal} />
        <OnboardingTutorialModal onClose={() => setShowOnboardingTutorial(false)} onOpenLibrary={() => setShowSimulationLibraryRequest(true)} onOpenSiteLibrary={() => setShowSiteLibraryRequest(true)} open={showOnboardingTutorial} />
      </main>
    );
  }

  return (
    <main
      ref={appShellRef}
      className={`app-shell ${isMapExpanded ? "is-map-expanded" : ""} ${
        isProfileExpanded ? "is-profile-expanded" : ""
      } ${
        isReadOnlyShell ? "is-readonly-shell" : ""
      } ${
        isMobileViewport ? "is-mobile-shell" : ""
      } ${
        isMobileViewport ? `mobile-panel-${mobileActivePanel}` : ""
      } ${
        isMobileViewport ? `mobile-bottom-${mobileBottomPanelMode}` : ""
      } ${
        isNavigatorHidden ? "is-navigator-hidden" : ""
      } ${
        isInspectorHidden ? "is-inspector-hidden" : ""
      } ${
        isProfileHidden ? "is-profile-hidden" : ""
      }`}
      style={shellStyle}
    >
      {!isMobileViewport && !isMapExpanded && !isProfileExpanded && (isNavigatorHidden || isInspectorHidden || isProfileHidden) ? (
        <div className="collapsed-panel-controls" aria-label="Restore hidden panels">
          {isNavigatorHidden ? (
            <button
              aria-label="Show Navigator panel"
              className="map-control-btn map-control-btn-icon collapsed-panel-btn collapsed-panel-btn-navigator"
              onClick={() => setIsNavigatorHidden(false)}
              title="Show Navigator"
              type="button"
            >
              <PanelLeft aria-hidden="true" strokeWidth={1.8} />
            </button>
          ) : null}
          {isInspectorHidden ? (
            <button
              aria-label="Show Inspector panel"
              className="map-control-btn map-control-btn-icon collapsed-panel-btn collapsed-panel-btn-inspector"
              onClick={() => setIsInspectorHidden(false)}
              title="Show Inspector"
              type="button"
            >
              <PanelRight aria-hidden="true" strokeWidth={1.8} />
            </button>
          ) : null}
          {isProfileHidden ? (
            <button
              aria-label="Show Profile panel"
              className="map-control-btn map-control-btn-icon collapsed-panel-btn collapsed-panel-btn-profile"
              onClick={() => setIsProfileHidden(false)}
              title="Show Profile"
              type="button"
            >
              <PanelBottom aria-hidden="true" strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
      ) : null}
      {!isMobileViewport && !isMapExpanded && !isProfileExpanded && !isNavigatorHidden && (accessState === "granted" || accessState === "readonly" || isAnonymousBootstrapShell) ? (
          <Sidebar
            authBootstrapPending={accessState === "checking"}
            hideLibraryBrowsing={isReadOnlyShell}
            onOpenHelp={openOnboardingTutorial}
            readOnly={!canPersistWorkspace}
            panelToggleControl={
              isMobileViewport ? (
                panelSizeControls("Navigator")
              ) : (
                <button
                  aria-label={isNavigatorHidden ? "Show Navigator panel" : "Hide Navigator panel"}
                  className="user-icon-button"
                  onClick={() => setIsNavigatorHidden((prev) => !prev)}
                  title={isNavigatorHidden ? "Show Navigator" : "Hide Navigator"}
                  type="button"
                >
                  {isNavigatorHidden ? <PanelLeft aria-hidden="true" strokeWidth={1.8} /> : <PanelLeftClose aria-hidden="true" strokeWidth={1.8} />}
                </button>
              )
            }
            simulationDisplayLabel={undefined}
        />
      ) : null}
      <section
        aria-hidden={isMobileViewport ? mobileBottomPanelMode === "hidden" || mobileActivePanel !== "inspector" : undefined}
        aria-labelledby={isMobileViewport ? mobileInspectorTabId : undefined}
        className={`workspace-panel ${isMapExpanded ? "is-map-expanded" : ""} ${isProfileExpanded ? "is-profile-expanded" : ""}`}
        id={isMobileViewport ? mobileInspectorPanelId : undefined}
        role={isMobileViewport ? "tabpanel" : undefined}
      >
        {accessState === "checking" ? (
          <div className="workspace-header-actions">
            <span className="field-help">Checking access in the background. Anonymous mode is available while this resolves.</span>
          </div>
        ) : null}
        {!isOnline && !offlineBannerDismissed ? (
          <div className="offline-banner" role="status">
            <span>Offline. Changes are saved locally and will sync when connection returns.</span>
            <div className="chip-group">
              <button
                className="inline-action"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent(OPEN_SYNC_MODAL_EVENT));
                }}
                type="button"
              >
                Open Sync Status
              </button>
              <button className="inline-action" onClick={() => setOfflineBannerDismissed(true)} type="button">
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
        {workspaceState === "no-simulation" && !isReadOnlyShell ? (
          <div className="empty-workspace-overlay">
            <div className="empty-workspace-message">
              <p>Open an existing simulation or create a new one to continue.</p>
              <button
                className="inline-action"
                onClick={() => setShowSimulationLibraryRequest(true)}
                type="button"
              >
                Open Library
              </button>
            </div>
          </div>
        ) : null}
        {workspaceState === "blank-simulation" && !appNotice ? (
          <div className="workspace-header-actions">
            <span className="field-help">This Simulation is blank. Add sites from the map or Site Library to continue.</span>
          </div>
        ) : null}
        <div className="workspace-header-actions">
          {accessState === "readonly" && isLocalRuntime ? (
            <button
              className="inline-action"
              onClick={() => {
                try {
                  localStorage.removeItem(LOCAL_FORCE_READONLY_KEY);
                } catch {
                  // ignore storage errors
                }
                window.location.reload();
              }}
              type="button"
            >
              Return to Local User
            </button>
          ) : null}
        </div>
        <MapView
          isMapExpanded={isMapExpanded}
          showInspector={
            !isMapExpanded &&
            !isProfileExpanded &&
            !isInspectorHidden &&
            (!isMobileViewport || (mobileActivePanel === "inspector" && mobileBottomPanelMode !== "hidden"))
          }
          showMultiSelectToggle={isMobileViewport}
          canPersist={canPersistWorkspace}
          inspectorHeaderActions={
            <div className="map-inspector-header-actions">
              {!isMobileViewport ? (
                <button
                  aria-label={isInspectorHidden ? "Show Inspector panel" : "Hide Inspector panel"}
                  className="map-control-btn map-control-btn-icon"
                  onClick={() => setIsInspectorHidden((prev) => !prev)}
                  title={isInspectorHidden ? "Show Inspector" : "Hide Inspector"}
                  type="button"
                >
                  {isInspectorHidden ? <PanelRight aria-hidden="true" strokeWidth={1.8} /> : <PanelRightClose aria-hidden="true" strokeWidth={1.8} />}
                </button>
              ) : null}
              <div className="map-inspector-header-actions-right">
                {accessState === "granted" ? (
                  <button
                    aria-label="Share"
                    className="map-control-btn map-control-btn-icon"
                    onClick={openShareModalOrCopy}
                    title="Share"
                    type="button"
                  >
                    <Share aria-hidden="true" strokeWidth={1.8} />
                  </button>
                ) : null}
                {isMobileViewport ? panelSizeControls("Inspector") : null}
              </div>
            </div>
          }
          readOnly={!canPersistWorkspace}
          onToggleMapExpanded={() => {
            setIsProfileExpanded(false);
            if (isMobileViewport && mobileBottomPanelMode === "full") {
              setMobileBottomPanelVisibility("normal");
            }
            setIsMapExpanded((prev) => !prev);
          }}
          notice={
            appNotice
              ? {
                  message: appNotice.message,
                  tone: appNotice.tone,
                  onDismiss: appNotice.persistent ? () => setAppNotice(null) : undefined,
                }
              : undefined
          }
          fitBottomInset={
            isMobileViewport || isMapExpanded || isProfileExpanded || isProfileHidden
              ? 30
              : Math.max(220, typeof window !== "undefined" ? window.innerHeight * 0.32 : 220) + 18 + 18
          }
        />
        {isMobileViewport ? (
          <MobileWorkspaceTabs
            activePanel={mobileActivePanel}
            inspectorPanelId={mobileInspectorPanelId}
            inspectorTabId={mobileInspectorTabId}
            mode={mobileBottomPanelMode}
            navigatorPanelId={mobileNavigatorPanelId}
            navigatorTabId={mobileNavigatorTabId}
            profilePanelId={mobileProfilePanelId}
            profileTabId={mobileProfileTabId}
            setIsMapExpanded={setIsMapExpanded}
            setMobileActivePanel={setMobileActivePanel}
            setMobileBottomPanelVisibility={setMobileBottomPanelVisibility}
          />
        ) : null}
        {!isMobileViewport && !isMapExpanded && !isProfileHidden ? (
          <LinkProfileChart
            isExpanded={isProfileExpanded}
            onToggleExpanded={toggleProfileExpanded}
            rowControls={
              <button
                aria-label={isProfileHidden ? "Show Profile panel" : "Hide Profile panel"}
                className="chart-endpoint-swap chart-endpoint-icon"
                onClick={() => {
                  setIsProfileHidden((prev) => {
                    const next = !prev;
                    if (next) setIsProfileExpanded(false);
                    return next;
                  });
                }}
                title={isProfileHidden ? "Show Profile" : "Hide Profile"}
                type="button"
              >
                {isProfileHidden ? <PanelBottom aria-hidden="true" strokeWidth={1.8} /> : <PanelBottomClose aria-hidden="true" strokeWidth={1.8} />}
              </button>
            }
            showExpandToggle
          />
        ) : null}
        {isMobileViewport && !isMapExpanded && mobileActivePanel === "profile" && mobileBottomPanelMode !== "hidden" ? (
          <div
            aria-labelledby={mobileProfileTabId}
            className="mobile-workspace-panel mobile-workspace-panel-shell"
            id={mobileProfilePanelId}
            role="tabpanel"
          >
            <LinkProfileChart
              isExpanded={mobileBottomPanelMode === "full"}
              onToggleExpanded={toggleProfileExpanded}
              rowControls={panelSizeControls("Profile", "chart")}
              showExpandToggle={false}
            />
          </div>
        ) : null}
        {isMobileViewport && !isMapExpanded && mobileActivePanel === "navigator" && mobileBottomPanelMode !== "hidden" ? (
          <div
            aria-labelledby={mobileNavigatorTabId}
            className="mobile-workspace-panel mobile-workspace-panel-shell mobile-workspace-panel-navigator"
            id={mobileNavigatorPanelId}
            role="tabpanel"
          >
            {(accessState === "granted" || accessState === "readonly" || isAnonymousBootstrapShell) ? (
              <Sidebar
                authBootstrapPending={accessState === "checking"}
                hideLibraryBrowsing={isReadOnlyShell}
                onOpenHelp={openOnboardingTutorial}
                readOnly={!canPersistWorkspace}
                panelToggleControl={panelSizeControls("Navigator")}
              />
            ) : null}
          </div>
        ) : null}
      </section>
      {isMapExpanded || isProfileExpanded || (!isMobileViewport && (isNavigatorHidden || isInspectorHidden || isProfileHidden)) ? (
        <div className="floating-attribution-pill">
          <span>&copy;</span>
          <a href={resolvedBasemap.attributionUrl} rel="noreferrer" target="_blank">
            {resolvedBasemap.attribution.replace(/©/g, "").trim()}
          </a>
          <span>&copy;</span>
          <a href="https://github.com/maplibre/maplibre-gl-js" rel="noreferrer" target="_blank">
            MapLibre
          </a>
        </div>
      ) : null}
      <WelcomeModal onClose={closeWelcome} onCreateNewSimulation={createNewFromWelcome} onOpenLibrary={openLibraryFromWelcome} onOpenOnboarding={openWelcomeFromWelcome} open={showWelcomeModal} />
      <OnboardingTutorialModal onClose={() => setShowOnboardingTutorial(false)} onOpenLibrary={() => setShowSimulationLibraryRequest(true)} onOpenSiteLibrary={() => setShowSiteLibraryRequest(true)} open={showOnboardingTutorial} />
      {showLibraryFromRequest && !isReadOnlyShell ? (
        <ModalOverlay
          aria-label="Simulation Library"
          onClose={() => setShowLibraryFromRequest(false)}
        >
          <SimulationLibraryPanel
            onClose={() => setShowLibraryFromRequest(false)}
            onLoadSimulation={(presetId) => {
              loadSimulationPreset(presetId);
              if (shouldCloseSimulationLibraryOnLoad({ presetId })) {
                setShowLibraryFromRequest(false);
              }
              try {
                localStorage.setItem(LAST_SIMULATION_REF_KEY, `saved:${presetId}`);
              } catch {
                // ignore storage errors
              }
            }}
          />
        </ModalOverlay>
      ) : null}
      {showShareModal ? (
        <ModalOverlay aria-label="Share simulation" onClose={closeShareModal}>
          <div className="library-manager-card">
            <div className="library-manager-header">
              <h2>Share Simulation</h2>
              <button aria-label="Close" className="inline-action inline-action-icon" onClick={closeShareModal} title="Close" type="button">
                <CircleX aria-hidden="true" strokeWidth={1.8} />
              </button>
            </div>
            {!activeSimulation ? (
              <p className="field-help">Open a saved simulation first. Unsaved workspace state cannot be deep-linked.</p>
            ) : (
              <>
                <p className="field-help">This link opens the same simulation, selected path, map view, and overlay mode.</p>
                <div style={{ display: "flex", gap: "0.5em", alignItems: "center" }}>
                  <input className="locale-select" readOnly style={{ flex: 1, minWidth: 0 }} value={currentShareLink} />
                  <button
                    aria-label="Copy link"
                    className="inline-action inline-action-icon"
                    onClick={() => void copyCurrentLink()}
                    title="Copy link"
                    type="button"
                  >
                    <Copy aria-hidden="true" strokeWidth={1.8} />
                  </button>
                </div>
                {toVisibility(activeSimulation.visibility) === "private" ? (
                  <div className="panel-section compact-panel">
                    <h4>Private Simulation</h4>
                    <p className="field-help">This simulation is private. Choose how to share it:</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75em", marginTop: "0.5em" }}>
                      {/* Option A: Upgrade to shared */}
                      <div className="panel-section compact-panel" style={{ display: "flex", flexDirection: "column", gap: "0.5em" }}>
                        <Globe aria-hidden="true" size={22} strokeWidth={1.6} />
                        <strong>Make Broadly Accessible</strong>
                        <p className="field-help" style={{ flex: 1 }}>
                          Anyone with the link can view. The simulation
                          {referencedPrivateSites.length ? ` and ${referencedPrivateSites.length} referenced site(s)` : ""} will be set to Shared.
                          {referencedPrivateSites.some((site) => !canEditResource(site)) ? " Some sites require owner access." : ""}
                        </p>
                        <button className="inline-action" disabled={shareBusy} onClick={() => void runUpgradeAndShare()} type="button">
                          Upgrade &amp; Copy Link
                        </button>
                      </div>
                      {/* Option B: Specific users */}
                      <div className="panel-section compact-panel" style={{ display: "flex", flexDirection: "column", gap: "0.5em" }}>
                        <Users aria-hidden="true" size={22} strokeWidth={1.6} />
                        <strong>Share with Specific Users</strong>
                        <p className="field-help">
                          Stays private. Only the users you add can access the link when signed in.
                        </p>
                        {/* Selected users */}
                        {shareSpecificUsers.length > 0 ? (
                          <div className="chip-group collaborator-selected-list">
                            {shareSpecificUsers.map((uid) => {
                              const user = shareDirectory.find((u) => u.id === uid);
                              return (
                                <span className="site-quick-item" key={uid}>
                                  <span>{user?.username ?? uid}</span>
                                  <select
                                    aria-label={`Role for ${user?.username ?? uid}`}
                                    onChange={(e) => setShareSpecificRoles((prev) => ({ ...prev, [uid]: e.target.value as "viewer" | "editor" }))}
                                    value={shareSpecificRoles[uid] ?? "viewer"}
                                  >
                                    <option value="viewer">Viewer</option>
                                    <option value="editor">Editor</option>
                                  </select>
                                  <button
                                    className="inline-action"
                                    onClick={() => setShareSpecificUsers((prev) => prev.filter((id) => id !== uid))}
                                    type="button"
                                  >
                                    Remove
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        ) : null}
                        {/* Search */}
                        <div style={{ display: "flex", gap: "0.4em", alignItems: "center" }}>
                          <UserRoundSearch aria-hidden="true" size={16} strokeWidth={1.6} style={{ flexShrink: 0 }} />
                          <input
                            onChange={(e) => setShareUserQuery(e.target.value)}
                            placeholder="Search by name or email"
                            style={{ flex: 1, minWidth: 0 }}
                            type="text"
                            value={shareUserQuery}
                          />
                        </div>
                        {/* Candidates — only show when typing */}
                        {shareUserQuery.trim() ? (
                          <div className="collaborator-candidate-list">
                            {shareDirectoryBusy ? (
                              <p className="field-help">Loading…</p>
                            ) : (
                              shareDirectory
                                .filter((u) => !shareSpecificUsers.includes(u.id) && u.id !== currentUser?.id)
                                .filter((u) => u.username.toLowerCase().includes(shareUserQuery.toLowerCase()) || u.email.toLowerCase().includes(shareUserQuery.toLowerCase()))
                                .slice(0, 6)
                                .map((u) => (
                                  <button
                                    className="site-quick-item"
                                    key={u.id}
                                    onClick={() => {
                                      setShareSpecificUsers((prev) => prev.includes(u.id) ? prev : [...prev, u.id]);
                                      setShareUserQuery("");
                                    }}
                                    type="button"
                                  >
                                    <UserRoundPlus aria-hidden="true" size={14} strokeWidth={1.6} />
                                    <span>{u.username}</span>
                                    {u.email ? <span className="field-help">{u.email}</span> : null}
                                  </button>
                                ))
                            )}
                            {!shareDirectoryBusy && shareDirectory.filter((u) => !shareSpecificUsers.includes(u.id) && u.id !== currentUser?.id && (u.username.toLowerCase().includes(shareUserQuery.toLowerCase()) || u.email.toLowerCase().includes(shareUserQuery.toLowerCase()))).length === 0 ? (
                              <p className="field-help">No matching users.</p>
                            ) : null}
                          </div>
                        ) : null}
                        <div style={{ marginTop: "auto" }}>
                          <button
                            className="inline-action"
                            disabled={shareSpecificBusy || !shareSpecificUsers.length}
                            onClick={() => void runShareWithSpecificUsers()}
                            style={{ display: "flex", alignItems: "center", gap: "0.35em" }}
                            type="button"
                          >
                            <Copy aria-hidden="true" size={14} strokeWidth={1.8} />
                            Save &amp; Copy Link
                          </button>
                        </div>
                        {shareSpecificStatus ? <p className="field-help">{shareSpecificStatus}</p> : null}
                      </div>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </ModalOverlay>
      ) : null}
    </main>
  );
}
