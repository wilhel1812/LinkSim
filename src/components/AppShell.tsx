import { lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDeepLinkStatus, fetchMe, setLocalDevRole } from "../lib/cloudUser";
import { fetchCloudLibrary, fetchPublicSimulationLibrary, pushCloudLibrary } from "../lib/cloudLibrary";
import { buildDeepLinkUrl, parseDeepLinkFromLocation, slugifyName } from "../lib/deepLink";
import { getCurrentRuntimeEnvironment } from "../lib/environment";
import { getUiErrorMessage } from "../lib/uiError";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { useAppStore } from "../store/appStore";
import { LinkProfileChart } from "./LinkProfileChart";
import { MapView } from "./MapView";
import { ModalOverlay } from "./ModalOverlay";
import { Sidebar } from "./Sidebar";
const OnboardingTutorialModal = lazy(() => import("./OnboardingTutorialModal"));
import { UserAdminPanel } from "./UserAdminPanel";

const ONBOARDING_SEEN_KEY_PREFIX = "linksim:onboarding-seen:v1:";
const MOBILE_WARNING_DISMISS_KEY = "linksim:mobile-warning-dismissed:v1";
const LOCAL_FORCE_READONLY_KEY = "linksim:local-force-readonly:v1";
const OPEN_SYNC_MODAL_EVENT = "linksim:open-sync-modal";

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
  const setMapOverlayMode = useAppStore((state) => state.setMapOverlayMode);
  const updateMapViewport = useAppStore((state) => state.updateMapViewport);
  const updateSimulationPresetEntry = useAppStore((state) => state.updateSimulationPresetEntry);
  const updateSiteLibraryEntry = useAppStore((state) => state.updateSiteLibraryEntry);
  const selectedScenarioId = useAppStore((state) => state.selectedScenarioId);
  const selectedLinkId = useAppStore((state) => state.selectedLinkId);
  const mapViewport = useAppStore((state) => state.mapViewport);
  const mapOverlayMode = useAppStore((state) => state.mapOverlayMode);
  const links = useAppStore((state) => state.links);
  const simulationPresets = useAppStore((state) => state.simulationPresets);
  const siteLibrary = useAppStore((state) => state.siteLibrary);
  const sites = useAppStore((state) => state.sites);
  const initializeCloudSync = useAppStore((state) => state.initializeCloudSync);
  const performCloudSyncPush = useAppStore((state) => state.performCloudSyncPush);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const currentUser = useAppStore((state) => state.currentUser);
  const isOnline = useAppStore((state) => state.isOnline);
  const setIsOnline = useAppStore((state) => state.setIsOnline);
  const isInitializing = useAppStore((state) => state.isInitializing);
  const setShowSimulationLibraryRequest = useAppStore((state) => state.setShowSimulationLibraryRequest);

  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [isProfileExpanded, setIsProfileExpanded] = useState(false);
  const [accessState, setAccessState] = useState<"checking" | "granted" | "readonly" | "pending" | "locked">("checking");
  const [activeUserId, setActiveUserId] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
  const [showMobileWarning, setShowMobileWarning] = useState(false);
  const [localDevStatus, setLocalDevStatus] = useState<string | null>(null);
  const [offlineBannerDismissed, setOfflineBannerDismissed] = useState(false);
  const deepLinkAppliedRef = useRef(false);

  const { theme, variant } = useThemeVariant();
  const runtimeEnvironment = getCurrentRuntimeEnvironment();
  const envBadgeLabel = runtimeEnvironment === "local" ? "LOCAL" : runtimeEnvironment === "staging" ? "STAGING" : "";
  const isLocalRuntime = runtimeEnvironment === "local";

  const deepLinkParse = useMemo(() => parseDeepLinkFromLocation(window.location), []);
  const activeSimulation = useMemo(
    () => simulationPresets.find((preset) => preset.id === selectedScenarioId) ?? null,
    [simulationPresets, selectedScenarioId],
  );
  const canPersistWorkspace =
    accessState === "granted" && (!activeSimulation || canEditResource(activeSimulation));
  const selectedLink = useMemo(
    () => links.find((link) => link.id === selectedLinkId) ?? links[0] ?? null,
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
    return buildDeepLinkUrl(
      {
        version: 1,
        simulationId: activeSimulation.id,
        simulationSlug,
        ...(selectedLink ? { selectedLinkId: selectedLink.id } : {}),
        ...(selectedLink?.name ? { selectedLinkSlug: selectedLink.name } : {}),
        overlayMode: mapOverlayMode,
        ...(mapViewport
          ? {
              mapViewport: {
                lat: mapViewport.center.lat,
                lon: mapViewport.center.lon,
                zoom: mapViewport.zoom,
              },
            }
          : {}),
      },
      window.location.origin,
      "/",
    );
  }, [activeSimulation, selectedLink, mapOverlayMode, mapViewport]);

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
    void (async () => {
      try {
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
          setAccessState("readonly");
          setDeepLinkNotice("Local read-only mode.");
          return;
        }
        const profile = await fetchMe();
        setCurrentUser(profile);
        setActiveUserId(profile.id);
        try {
          const seen = localStorage.getItem(`${ONBOARDING_SEEN_KEY_PREFIX}${profile.id}`);
          if (!seen) setShowOnboarding(true);
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
        const message = getUiErrorMessage(error);
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
  }, [deepLinkParse.ok, isLocalRuntime]);

  useEffect(() => {
    if (accessState === "granted") {
      console.log("[AppShell] Access granted, initializing cloud sync...");
      void initializeCloudSync();
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
    if ((accessState !== "granted" && accessState !== "readonly") || deepLinkAppliedRef.current) return;
    deepLinkAppliedRef.current = true;
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
      return;
    }

    void (async () => {
      const payload = deepLinkParse.payload;
      let resolvedSimulationId = payload.simulationId ?? "";
      const resolveBySlug = (): string | undefined => {
        const slug = payload.simulationSlug?.trim().toLowerCase();
        if (!slug) return undefined;
        const bySlug = useAppStore
          .getState()
          .simulationPresets.find((preset) => {
            const presetSlugValue =
              typeof (preset as { slug?: unknown }).slug === "string"
                ? String((preset as { slug?: unknown }).slug)
                : preset.name;
            const presetSlug = slugifyName(presetSlugValue);
            if (presetSlug === slug) return true;
            const aliases = Array.isArray((preset as { slugAliases?: unknown }).slugAliases)
              ? ((preset as { slugAliases?: string[] }).slugAliases ?? [])
              : [];
            return aliases.some((alias) => slugifyName(alias) === slug);
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
                return;
              }
            } else {
              setDeepLinkNotice("This shared simulation no longer exists.");
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
            return;
          }
          if (status.status === "missing") {
            setDeepLinkNotice("This shared simulation no longer exists.");
            return;
          }
          if (status.simulationId) {
            resolvedSimulationId = status.simulationId;
          }
        } catch {
          // Ignore and use generic message.
        }
        setDeepLinkNotice("This shared simulation is unavailable.");
        return;
      }

      if (!resolvedSimulationId) {
        setDeepLinkNotice("This shared simulation is unavailable.");
        return;
      }
      loadSimulationPreset(resolvedSimulationId);
      if (payload.selectedLinkId) {
        const latest = useAppStore.getState();
        if (latest.links.some((link) => link.id === payload.selectedLinkId)) {
          setSelectedLinkId(payload.selectedLinkId);
        }
      } else if (payload.selectedLinkSlug) {
        const latest = useAppStore.getState();
        const bySlug = latest.links.find((link) =>
          slugifyName(link.name ?? "") === payload.selectedLinkSlug,
        );
        if (bySlug) setSelectedLinkId(bySlug.id);
      }
      if (payload.overlayMode) {
        setMapOverlayMode(payload.overlayMode);
      }
      if (payload.mapViewport) {
        updateMapViewport({
          center: { lat: payload.mapViewport.lat, lon: payload.mapViewport.lon },
          zoom: payload.mapViewport.zoom,
        });
      }
      setDeepLinkNotice("Loaded shared simulation link.");
    })();
  }, [
    accessState,
    deepLinkParse,
    importLibraryData,
    loadSimulationPreset,
    setMapOverlayMode,
    setSelectedLinkId,
    updateMapViewport,
  ]);

  const closeOnboarding = () => {
    setShowOnboarding(false);
    if (!activeUserId) return;
    try {
      localStorage.setItem(`${ONBOARDING_SEEN_KEY_PREFIX}${activeUserId}`, "1");
    } catch {
      // ignore storage errors
    }
  };

  const copyCurrentLink = useCallback(async () => {
    if (!activeSimulation) {
      setShareStatus("Open a saved simulation first. Unsaved workspace state cannot be shared as a deep link.");
      return;
    }
    if (!currentShareLink) {
      setShareStatus("Unable to build share link for this simulation.");
      return;
    }
    let linkToCopy = currentShareLink;
    try {
      const parsed = new URL(currentShareLink);
      parsed.pathname = decodeURIComponent(parsed.pathname);
      linkToCopy = parsed.toString();
    } catch {
      linkToCopy = currentShareLink;
    }
    await copyToClipboard(linkToCopy);
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

  if (accessState === "checking") {
    return (
      <main className="app-shell access-locked-shell">
        <section className="panel-section access-locked-panel">
          <h2>Checking access…</h2>
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
        <div className="floating-help-cluster">
          {envBadgeLabel ? <span className="floating-env-badge">{envBadgeLabel}</span> : null}
          <button
            aria-label="Open onboarding"
            className="floating-help-button"
            onClick={() => setShowOnboarding(true)}
            type="button"
          >
            ?
          </button>
        </div>
        <OnboardingTutorialModal onClose={closeOnboarding} open={showOnboarding} />
      </main>
    );
  }

  if (accessState === "locked") {
    return (
      <main className="app-shell access-locked-shell">
        <section className="panel-section access-locked-panel">
          <h2>Access unavailable</h2>
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
        <div className="floating-help-cluster">
          {envBadgeLabel ? <span className="floating-env-badge">{envBadgeLabel}</span> : null}
          <button
            aria-label="Open onboarding"
            className="floating-help-button"
            onClick={() => setShowOnboarding(true)}
            type="button"
          >
            ?
          </button>
        </div>
        <OnboardingTutorialModal onClose={closeOnboarding} open={showOnboarding} />
      </main>
    );
  }

  return (
    <main
      className={`app-shell ${isMapExpanded || isProfileExpanded ? "is-map-expanded" : ""} ${
        accessState === "readonly" ? "is-readonly-shell" : ""
      }`}
    >
      {!isMapExpanded && !isProfileExpanded && (accessState === "granted" || accessState === "readonly") ? <Sidebar /> : null}
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
        {sites.length === 0 ? (
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
        {!isProfileExpanded ? (
          <MapView
            isMapExpanded={isMapExpanded}
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
              setIsMapExpanded((prev) => !prev);
            }}
          />
        ) : null}
        {!isMapExpanded ? (
          <LinkProfileChart
            isExpanded={isProfileExpanded}
            onToggleExpanded={() => {
              setIsMapExpanded(false);
              setIsProfileExpanded((prev) => !prev);
            }}
          />
        ) : null}
      </section>
      <div className="floating-help-cluster">
        {envBadgeLabel ? <span className="floating-env-badge">{envBadgeLabel}</span> : null}
        <button
          aria-label="Open onboarding"
          className="floating-help-button"
          onClick={() => setShowOnboarding(true)}
          type="button"
        >
          ?
        </button>
      </div>
      <OnboardingTutorialModal onClose={closeOnboarding} open={showOnboarding} />
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
