import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDeepLinkStatus, fetchMe, setLocalDevRole } from "../lib/cloudUser";
import { fetchCloudLibrary, fetchPublicSimulationLibrary, pushCloudLibrary } from "../lib/cloudLibrary";
import { buildDeepLinkPathname, buildDeepLinkUrl, canonicalizeDeepLinkKey, parseDeepLinkFromLocation, slugifyName } from "../lib/deepLink";
import { emptyWorkspaceState } from "../lib/emptyWorkspaceState";
import { getCurrentRuntimeEnvironment } from "../lib/environment";
import { getUiErrorMessage } from "../lib/uiError";
import { initializeMigrations, runMigrations } from "../lib/migrations";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { useAppStore } from "../store/appStore";
import { LinkProfileChart } from "./LinkProfileChart";
import { MapView } from "./MapView";
import { ModalOverlay } from "./ModalOverlay";
import OnboardingTutorialModal from "./OnboardingTutorialModal";
import WelcomeModal from "./WelcomeModal";
import { Sidebar } from "./Sidebar";
import { UserAdminPanel } from "./UserAdminPanel";

initializeMigrations();

const ONBOARDING_SEEN_KEY_PREFIX = "linksim:onboarding-seen:v1:";
const MOBILE_WARNING_DISMISS_KEY = "linksim:mobile-warning-dismissed:v1";
const LOCAL_FORCE_READONLY_KEY = "linksim:local-force-readonly:v1";
const OPEN_SYNC_MODAL_EVENT = "linksim:open-sync-modal";
const ACCESS_CHECK_TIMEOUT_MS = 10_000;
type MobileWorkspacePanel = "profile" | "inspector" | "sidebar";

const toVisibility = (value: unknown): "private" | "public" | "shared" =>
  value === "shared" || value === "public" ? value : "private";

const canEditResource = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const resource = value as { effectiveRole?: unknown };
  const role = resource.effectiveRole;
  if (role === "owner" || role === "admin" || role === "editor") return true;
  return false;
};

const copyToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
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
  const initializeCloudSync = useAppStore((state) => state.initializeCloudSync);
  const performCloudSyncPush = useAppStore((state) => state.performCloudSyncPush);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const currentUser = useAppStore((state) => state.currentUser);
  const isOnline = useAppStore((state) => state.isOnline);
  const setIsOnline = useAppStore((state) => state.setIsOnline);
  const isInitializing = useAppStore((state) => state.isInitializing);
  const setShowSimulationLibraryRequest = useAppStore((state) => state.setShowSimulationLibraryRequest);
  const setShowNewSimulationRequest = useAppStore((state) => state.setShowNewSimulationRequest);
  const setShowSiteLibraryRequest = useAppStore((state) => state.setShowSiteLibraryRequest);

  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [isProfileExpanded, setIsProfileExpanded] = useState(false);
  const [accessState, setAccessState] = useState<"checking" | "granted" | "readonly" | "pending" | "locked">("checking");
  const [accessDiagnosticMessage, setAccessDiagnosticMessage] = useState<string | null>(null);
  const [activeUserId, setActiveUserId] = useState("");
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [showOnboardingTutorial, setShowOnboardingTutorial] = useState(false);
  const [libraryAutoOpened, setLibraryAutoOpened] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
  const [showMobileWarning, setShowMobileWarning] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobileActivePanel, setMobileActivePanel] = useState<MobileWorkspacePanel>("profile");
  const [mobileControlsOccupied, setMobileControlsOccupied] = useState(0);
  const [localDevStatus, setLocalDevStatus] = useState<string | null>(null);
  const [offlineBannerDismissed, setOfflineBannerDismissed] = useState(false);
  const deepLinkAppliedRef = useRef(false);
  const cloudInitSeenRef = useRef(false);
  const cloudInitSettledRef = useRef(false);
  const appShellRef = useRef<HTMLElement | null>(null);

  const { theme, variant } = useThemeVariant();
  const runtimeEnvironment = getCurrentRuntimeEnvironment();
  const isLocalRuntime = runtimeEnvironment === "local";

  const deepLinkParse = useMemo(() => parseDeepLinkFromLocation(window.location), []);
  const activeSimulation = useMemo(
    () => simulationPresets.find((preset) => preset.id === selectedScenarioId) ?? null,
    [simulationPresets, selectedScenarioId],
  );
  const canPersistWorkspace =
    accessState === "granted" && (!activeSimulation || canEditResource(activeSimulation));
  const workspaceState = emptyWorkspaceState(sites.length, Boolean(activeSimulation));
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
    if (!deepLinkAppliedRef.current) return;

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
  }, [currentShareLink, activeSimulation, selectedSiteIds, sites]);

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
          setAccessState("readonly");
          setDeepLinkNotice("Local read-only mode.");
          return;
        }
        const profile = await fetchMe();
        if (cancelled || timedOut) return;
        window.clearTimeout(timeoutId);
        setAccessDiagnosticMessage(null);
        setCurrentUser(profile);
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
          setDeepLinkNotice("Read-only shared view.");
          return;
        }
        setAccessState("pending");
      } catch (error) {
        if (cancelled || timedOut) return;
        window.clearTimeout(timeoutId);
        const message = getUiErrorMessage(error);
        console.error("[AppShell] Access check failed", {
          message,
          isLocalRuntime,
          deepLinkMode: deepLinkParse.ok,
          online: typeof navigator === "undefined" ? true : navigator.onLine,
        });
        setAccessDiagnosticMessage(`Access check failed: ${message}`);
        if (message.includes("Session revoked by admin")) {
          window.location.href = "/cdn-cgi/access/logout";
          return;
        }
        if (deepLinkParse.ok && (message.includes("401") || message.includes("Unauthorized"))) {
          setAccessState("readonly");
          setDeepLinkNotice("Read-only shared view.");
          return;
        }
        setAccessState("locked");
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [deepLinkParse.ok, isLocalRuntime, isInitializing, setCurrentUser]);

  useEffect(() => {
    if (accessState === "granted") {
      console.log("[AppShell] Access granted, running migrations and initializing cloud sync...");
      void runMigrations().then(() => initializeCloudSync());
    }
  }, [accessState, initializeCloudSync]);

  const signOutOrReadonly = useCallback(() => {
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
  }, [deepLinkParse.ok, isLocalRuntime]);

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
        setDeepLinkNotice(`Local role switch failed: ${message}`);
      }
    },
    [],
  );

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
  }, [isMobileViewport, isMapExpanded, isProfileExpanded, mobileActivePanel]);

  useEffect(() => {
    const isMobile = window.matchMedia("(max-width: 900px)").matches;
    if (!isMobile) return;
    try {
      if (localStorage.getItem(MOBILE_WARNING_DISMISS_KEY) === "1") return;
    } catch {
      // ignore storage errors
    }
    setShowMobileWarning(true);
  }, []);

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
    if ((accessState !== "granted" && accessState !== "readonly") || deepLinkAppliedRef.current || isInitializing) return;
    if (!cloudInitSettledRef.current) return;
    if (!deepLinkParse.ok) {
      if (deepLinkParse.reason !== "missing_sim") {
        setDeepLinkNotice(
          deepLinkParse.reason === "invalid_version"
            ? "Unsupported deep-link format."
            : deepLinkParse.reason === "invalid_slug"
              ? "The shared link path is invalid."
              : "The shared link is missing a valid simulation id.",
        );
      }
      deepLinkAppliedRef.current = true;
      return;
    }

    void (async () => {
      const payload = deepLinkParse.payload;
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

      if (!exists) {
        try {
          const status = await fetchDeepLinkStatus({
            simulationId: resolvedSimulationId || undefined,
            simulationSlug: payload.simulationSlug,
          });
          if (status.status === "forbidden") {
            setDeepLinkNotice("You do not have access to this shared simulation.");
            if (accessState === "readonly") {
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
                // Keep forbidden notice.
              }
            }
            if (!exists) {
              deepLinkAppliedRef.current = true;
              return;
            }
          }
          if (status.status === "missing") {
            if (accessState === "readonly") {
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
                setDeepLinkNotice("This shared simulation no longer exists.");
                deepLinkAppliedRef.current = true;
                return;
              }
            } else {
              setDeepLinkNotice("This shared simulation no longer exists.");
              deepLinkAppliedRef.current = true;
              return;
            }
          }
          if (status.simulationId) {
            resolvedSimulationId = status.simulationId;
          }
        } catch {
          // Ignore and use generic message.
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
          setDeepLinkNotice("This shared simulation is unavailable.");
          deepLinkAppliedRef.current = true;
          return;
        }
      }

      if (!exists) {
        try {
          const status = await fetchDeepLinkStatus({
            simulationId: resolvedSimulationId || undefined,
            simulationSlug: payload.simulationSlug,
          });
          if (status.status === "forbidden") {
            setDeepLinkNotice("You do not have access to this shared simulation.");
            deepLinkAppliedRef.current = true;
            return;
          }
          if (status.status === "missing") {
            setDeepLinkNotice("This shared simulation no longer exists.");
            deepLinkAppliedRef.current = true;
            return;
          }
          if (status.simulationId) {
            resolvedSimulationId = status.simulationId;
          }
        } catch {
          // Ignore and use generic message.
        }
        setDeepLinkNotice("This shared simulation is unavailable.");
        deepLinkAppliedRef.current = true;
        return;
      }

      if (!resolvedSimulationId) {
        setDeepLinkNotice("This shared simulation is unavailable.");
        deepLinkAppliedRef.current = true;
        return;
      }
      loadSimulationPreset(resolvedSimulationId);
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
          setDeepLinkNotice("Could not resolve link selection from this deep link.");
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
          setDeepLinkNotice("Could not resolve all site selections from this deep link.");
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
  ]);

  const closeWelcome = () => {
    setShowWelcomeModal(false);
    if (!activeUserId) return;
    try {
      localStorage.setItem(`${ONBOARDING_SEEN_KEY_PREFIX}${activeUserId}`, "1");
    } catch {
      // ignore storage errors
    }
  };

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

  const copyCurrentLink = useCallback(async () => {
    if (!activeSimulation) {
      setShareStatus("Open a saved simulation first. Unsaved workspace state cannot be shared as a deep link.");
      return;
    }
    if (!currentShareLink) {
      setShareStatus("Unable to build share link for this simulation.");
      return;
    }
    await copyToClipboard(currentShareLink);
    setShareStatus("Share link copied.");
    setCopyToast("Copied to clipboard");
  }, [activeSimulation, currentShareLink]);

  useEffect(() => {
    if (!copyToast) return;
    const timer = window.setTimeout(() => setCopyToast(null), 1200);
    return () => window.clearTimeout(timer);
  }, [copyToast]);

  const runUpgradeAndShare = useCallback(async () => {
    if (!activeSimulation || !currentUser) {
      setShareStatus("No active saved simulation.");
      return;
    }
    if (!canEditResource(activeSimulation)) {
      setShareStatus("You do not have edit access to this simulation.");
      return;
    }
    const blockedSites = referencedPrivateSites.filter((site) => !canEditResource(site));
    if (blockedSites.length) {
      setShareStatus(
        `Cannot upgrade ${blockedSites.length} private site(s) because you do not have edit access to them.`,
      );
      return;
    }

    setShareBusy(true);
    setShareStatus("Upgrading visibility and syncing to cloud...");
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

      await copyCurrentLink();
      setShareStatus("Simulation and referenced sites are now Shared. Link copied.");
    } catch (error) {
      setShareStatus(`Upgrade failed: ${getUiErrorMessage(error)}`);
    } finally {
      setShareBusy(false);
    }
  }, [activeSimulation, copyCurrentLink, currentUser, referencedPrivateSites, updateSimulationPresetEntry, updateSiteLibraryEntry]);

  const shellStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isMobileViewport) return undefined;
    return {
      ["--mobile-controls-occupied" as string]: `${mobileControlsOccupied}px`,
    };
  }, [isMobileViewport, mobileControlsOccupied]);

  if (accessState === "checking") {
    return (
      <main className="app-shell access-locked-shell">
        <section className="panel-section access-locked-panel">
          <h2>Checking access…</h2>
          {accessDiagnosticMessage ? <p className="field-help">{accessDiagnosticMessage}</p> : null}
        </section>
      </main>
    );
  }

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
    return (
      <main className="app-shell access-locked-shell">
        <section className="panel-section access-locked-panel">
          <h2>Access unavailable</h2>
          {accessDiagnosticMessage ? <p className="field-help">{accessDiagnosticMessage}</p> : null}
          <p className="field-help">
            Your account session is valid, but this account is not available in LinkSim right now.
          </p>
          <p className="field-help">
            If your user was removed by an admin, ask for re-approval. Then sign out and sign in again.
          </p>
          <div className="chip-group">
            <button className="inline-action" onClick={signOutOrReadonly} type="button">
              Sign Out
            </button>
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
      className={`app-shell ${isMapExpanded || isProfileExpanded ? "is-map-expanded" : ""} ${
        accessState === "readonly" ? "is-readonly-shell" : ""
      } ${
        isMobileViewport ? "is-mobile-shell" : ""
      } ${
        isMobileViewport ? `mobile-panel-${mobileActivePanel}` : ""
      }`}
      style={shellStyle}
    >
      {!isMobileViewport && !isMapExpanded && !isProfileExpanded && (accessState === "granted" || accessState === "readonly") ? (
        <Sidebar onOpenHelp={openOnboardingTutorial} />
      ) : null}
      <section className={`workspace-panel ${isMapExpanded ? "is-map-expanded" : ""} ${isProfileExpanded ? "is-profile-expanded" : ""}`}>
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
        {accessState === "readonly" ? <p className="field-help">Read-only shared view.</p> : null}
        {workspaceState === "no-simulation" ? (
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
        {workspaceState === "blank-simulation" ? (
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
          {shareStatus ? <span className="field-help">{shareStatus}</span> : null}
          {deepLinkNotice ? <span className="field-help">{deepLinkNotice}</span> : null}
        </div>
        <MapView
          isMapExpanded={isMapExpanded}
          showInspector={!isMapExpanded && (!isMobileViewport || mobileActivePanel === "inspector")}
          showMultiSelectToggle={isMobileViewport}
          canPersist={canPersistWorkspace}
          onShare={
            accessState === "granted"
              ? () => {
                  setShareStatus(null);
                  if (!activeSimulation) {
                    setShareStatus(
                      "Open a saved simulation first. Unsaved workspace state cannot be shared as a deep link.",
                    );
                    return;
                  }
                  if (toVisibility(activeSimulation.visibility) === "private") {
                    setShowShareModal(true);
                    return;
                  }
                  void copyCurrentLink()
                    .then(() => setShareStatus("Copied to clipboard."))
                    .catch((error) => setShareStatus(getUiErrorMessage(error)));
                }
              : undefined
          }
          readOnly={!canPersistWorkspace}
          onToggleMapExpanded={() => {
            setIsProfileExpanded(false);
            setIsMapExpanded((prev) => {
              const next = !prev;
              if (isMobileViewport) {
                if (!next) {
                  setMobileActivePanel("profile");
                }
              }
              return next;
            });
          }}
        />
        {isMobileViewport ? (
          <div className="mobile-workspace-tabs" role="tablist" aria-label="Mobile workspace panels">
            <button
              aria-selected={mobileActivePanel === "sidebar"}
              className={`mobile-workspace-tab ${mobileActivePanel === "sidebar" ? "is-active" : ""}`}
              onClick={() => {
                setIsProfileExpanded(false);
                if (!isMapExpanded && mobileActivePanel === "sidebar") {
                  setIsMapExpanded(true);
                  return;
                }
                setIsMapExpanded(false);
                setMobileActivePanel("sidebar");
              }}
              role="tab"
              type="button"
            >
              Sidebar
            </button>
            <button
              aria-selected={mobileActivePanel === "inspector"}
              className={`mobile-workspace-tab ${mobileActivePanel === "inspector" ? "is-active" : ""}`}
              onClick={() => {
                setIsProfileExpanded(false);
                if (!isMapExpanded && mobileActivePanel === "inspector") {
                  setIsMapExpanded(true);
                  return;
                }
                setIsMapExpanded(false);
                setMobileActivePanel("inspector");
              }}
              role="tab"
              type="button"
            >
              Inspector
            </button>
            <button
              aria-selected={mobileActivePanel === "profile"}
              className={`mobile-workspace-tab ${mobileActivePanel === "profile" ? "is-active" : ""}`}
              onClick={() => {
                if (!isMapExpanded && mobileActivePanel === "profile") {
                  setIsMapExpanded(true);
                  setIsProfileExpanded(false);
                  return;
                }
                setIsMapExpanded(false);
                setMobileActivePanel("profile");
              }}
              role="tab"
              type="button"
            >
              Path Profile
            </button>
          </div>
        ) : null}
        {!isMobileViewport && !isMapExpanded ? (
          <LinkProfileChart
            isExpanded={isProfileExpanded}
            onToggleExpanded={() => {
              setIsMapExpanded(false);
              setIsProfileExpanded((prev) => !prev);
            }}
          />
        ) : null}
        {isMobileViewport && !isMapExpanded && mobileActivePanel === "profile" ? (
          <div className="mobile-workspace-panel" role="tabpanel" aria-label="Path profile panel">
            <LinkProfileChart
              isExpanded={isProfileExpanded}
              onToggleExpanded={() => {
                setIsMapExpanded(false);
                setIsProfileExpanded((prev) => !prev);
              }}
            />
          </div>
        ) : null}
        {isMobileViewport && !isMapExpanded && mobileActivePanel === "sidebar" ? (
          <div className="mobile-workspace-panel mobile-workspace-panel-sidebar" role="tabpanel" aria-label="Sidebar panel">
            {(accessState === "granted" || accessState === "readonly") ? <Sidebar onOpenHelp={openOnboardingTutorial} /> : null}
          </div>
        ) : null}
      </section>
      <WelcomeModal onClose={closeWelcome} onCreateNewSimulation={createNewFromWelcome} onOpenLibrary={openLibraryFromWelcome} onOpenOnboarding={openWelcomeFromWelcome} open={showWelcomeModal} />
      <OnboardingTutorialModal onClose={() => setShowOnboardingTutorial(false)} onOpenLibrary={() => setShowSimulationLibraryRequest(true)} onOpenSiteLibrary={() => setShowSiteLibraryRequest(true)} open={showOnboardingTutorial} />
      {showMobileWarning ? (
        <ModalOverlay aria-label="Mobile support notice" onClose={() => setShowMobileWarning(false)} tier="raised">
          <div className="library-manager-card mobile-warning-modal-card">
            <div className="library-manager-header">
              <h2>Mobile Support Notice</h2>
              <button
                className="inline-action"
                onClick={() => {
                  setShowMobileWarning(false);
                }}
                type="button"
              >
                Close
              </button>
            </div>
            <p className="field-help">
              LinkSim is currently designed to work best in a desktop environment. Mobile should work, but is not a delightful experience at the moment.
            </p>
            <div className="chip-group">
              <button
                className="inline-action"
                onClick={() => {
                  setShowMobileWarning(false);
                  try {
                    localStorage.setItem(MOBILE_WARNING_DISMISS_KEY, "1");
                  } catch {
                    // ignore storage errors
                  }
                }}
                type="button"
              >
                Don&apos;t show again
              </button>
            </div>
          </div>
        </ModalOverlay>
      ) : null}
      {copyToast ? <div className="copy-toast">{copyToast}</div> : null}
      {showShareModal ? (
        <ModalOverlay aria-label="Share simulation" onClose={() => setShowShareModal(false)}>
          <div className="library-manager-card">
            <div className="library-manager-header">
              <h2>Share Simulation</h2>
              <button className="inline-action" onClick={() => setShowShareModal(false)} type="button">
                Close
              </button>
            </div>
            {!activeSimulation ? (
              <p className="field-help">Open a saved simulation first. Unsaved workspace state cannot be deep-linked.</p>
            ) : (
              <>
                <p className="field-help">This link opens the same simulation, selected path, map view, and overlay mode.</p>
                <input className="locale-select" readOnly value={currentShareLink} />
                {toVisibility(activeSimulation.visibility) === "private" ? (
                  <div className="panel-section compact-panel">
                    <h4>Private Simulation</h4>
                    <p className="field-help">
                      This simulation is private. To make the share link broadly accessible, set this simulation and its referenced private sites to Shared.
                    </p>
                    <p className="field-help">
                      Referenced private sites: {referencedPrivateSites.length}
                    </p>
                    {referencedPrivateSites.length ? (
                      <ul className="field-help access-pending-list">
                        {referencedPrivateSites.map((site) => (
                          <li key={site.id}>
                            {site.name} {canEditResource(site) ? "" : "(no edit access)"}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="chip-group">
                      <button className="inline-action" disabled={shareBusy} onClick={() => void runUpgradeAndShare()} type="button">
                        Upgrade To Shared And Copy Link
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
            {shareStatus ? <p className="field-help">{shareStatus}</p> : null}
          </div>
        </ModalOverlay>
      ) : null}
    </main>
  );
}
