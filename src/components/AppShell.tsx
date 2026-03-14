import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDeepLinkStatus, fetchMe, type CloudUser } from "../lib/cloudUser";
import { fetchCloudLibrary, pushCloudLibrary } from "../lib/cloudLibrary";
import { buildDeepLinkUrl, parseDeepLinkFromLocation } from "../lib/deepLink";
import { getCurrentRuntimeEnvironment } from "../lib/environment";
import { getUiErrorMessage } from "../lib/uiError";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { useAppStore } from "../store/appStore";
import { LinkProfileChart } from "./LinkProfileChart";
import { MapView } from "./MapView";
import { ModalOverlay } from "./ModalOverlay";
import { OnboardingTutorialModal } from "./OnboardingTutorialModal";
import { Sidebar } from "./Sidebar";
import { UserAdminPanel } from "./UserAdminPanel";

const ONBOARDING_SEEN_KEY_PREFIX = "linksim:onboarding-seen:v1:";

const toVisibility = (value: unknown): "private" | "public" | "shared" =>
  value === "shared" || value === "public" ? value : "private";

const canEditResource = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const resource = value as { effectiveRole?: unknown; visibility?: unknown };
  const role = resource.effectiveRole;
  if (role === "owner" || role === "admin" || role === "editor") return true;
  return toVisibility(resource.visibility) === "shared";
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

  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [isProfileExpanded, setIsProfileExpanded] = useState(false);
  const [accessState, setAccessState] = useState<"checking" | "granted" | "pending" | "locked">("checking");
  const [activeUserId, setActiveUserId] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
  const [me, setMe] = useState<CloudUser | null>(null);
  const deepLinkAppliedRef = useRef(false);

  const { theme, variant } = useThemeVariant();
  const runtimeEnvironment = getCurrentRuntimeEnvironment();
  const envBadgeLabel = runtimeEnvironment === "local" ? "LOCAL" : runtimeEnvironment === "staging" ? "STAGING" : "";

  const deepLinkParse = useMemo(() => parseDeepLinkFromLocation(window.location), []);
  const activeSimulation = useMemo(
    () => simulationPresets.find((preset) => preset.id === selectedScenarioId) ?? null,
    [simulationPresets, selectedScenarioId],
  );
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
    return buildDeepLinkUrl(
      {
        version: 1,
        simulationId: activeSimulation.id,
        ...(selectedLink ? { selectedLinkId: selectedLink.id } : {}),
        overlayMode: mapOverlayMode,
        mapViewport: {
          lat: mapViewport.center.lat,
          lon: mapViewport.center.lon,
          zoom: mapViewport.zoom,
        },
      },
      window.location.origin,
      window.location.pathname,
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
    void (async () => {
      try {
        const profile = await fetchMe();
        setMe(profile);
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
        setAccessState(profile.isAdmin || profile.isModerator || profile.isApproved ? "granted" : "pending");
      } catch (error) {
        const message = getUiErrorMessage(error);
        if (
          message.includes("Session revoked by admin") ||
          message.includes("401") ||
          message.includes("Unauthorized")
        ) {
          window.location.href = "/cdn-cgi/access/logout";
          return;
        }
        setAccessState("locked");
      }
    })();
  }, []);

  useEffect(() => {
    if (accessState !== "granted" || deepLinkAppliedRef.current) return;
    deepLinkAppliedRef.current = true;
    if (!deepLinkParse.ok) {
      if (deepLinkParse.reason !== "missing_sim") {
        setDeepLinkNotice(
          deepLinkParse.reason === "invalid_version"
            ? "Unsupported deep-link format."
            : "The shared link is missing a valid simulation id.",
        );
      }
      return;
    }

    void (async () => {
      const payload = deepLinkParse.payload;
      let state = useAppStore.getState();
      let exists = state.simulationPresets.some((preset) => preset.id === payload.simulationId);

      if (!exists) {
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
          exists = state.simulationPresets.some((preset) => preset.id === payload.simulationId);
        } catch {
          // Keep checking through status endpoint below.
        }
      }

      if (!exists) {
        try {
          const status = await fetchDeepLinkStatus(payload.simulationId);
          if (status === "forbidden") {
            setDeepLinkNotice("You do not have access to this shared simulation.");
            return;
          }
          if (status === "missing") {
            setDeepLinkNotice("This shared simulation no longer exists.");
            return;
          }
        } catch {
          // Ignore and use generic message.
        }
        setDeepLinkNotice("This shared simulation is unavailable.");
        return;
      }

      loadSimulationPreset(payload.simulationId);
      if (payload.selectedLinkId) {
        const latest = useAppStore.getState();
        if (latest.links.some((link) => link.id === payload.selectedLinkId)) {
          setSelectedLinkId(payload.selectedLinkId);
        }
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
    await copyToClipboard(currentShareLink);
    setShareStatus("Share link copied.");
  }, [activeSimulation, currentShareLink]);

  const runUpgradeAndShare = useCallback(async () => {
    if (!activeSimulation || !me) {
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
  }, [activeSimulation, copyCurrentLink, me, referencedPrivateSites, updateSimulationPresetEntry, updateSiteLibraryEntry]);

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
            <button className="inline-action" onClick={() => (window.location.href = "/cdn-cgi/access/logout")} type="button">
              Sign Out
            </button>
          </div>
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
    <main className={`app-shell ${isMapExpanded || isProfileExpanded ? "is-map-expanded" : ""}`}>
      {!isMapExpanded && !isProfileExpanded ? <Sidebar /> : null}
      <section className={`workspace-panel ${isMapExpanded ? "is-map-expanded" : ""} ${isProfileExpanded ? "is-profile-expanded" : ""}`}>
        <div className="workspace-header-actions">
          <button className="inline-action" onClick={() => {
            setShowShareModal(true);
            setShareStatus(null);
          }} type="button">
            Share
          </button>
          {deepLinkNotice ? <span className="field-help">{deepLinkNotice}</span> : null}
        </div>
        {!isProfileExpanded ? (
          <MapView
            isMapExpanded={isMapExpanded}
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
                <div className="chip-group">
                  <button className="inline-action" disabled={shareBusy} onClick={() => void copyCurrentLink()} type="button">
                    Copy Link
                  </button>
                </div>
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
