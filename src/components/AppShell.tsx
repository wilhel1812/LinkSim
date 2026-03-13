import { useEffect, useState } from "react";
import { fetchMe } from "../lib/cloudUser";
import { getCurrentRuntimeEnvironment } from "../lib/environment";
import { getUiErrorMessage } from "../lib/uiError";
import { useAppStore } from "../store/appStore";
import { useThemeVariant } from "../hooks/useThemeVariant";
import { LinkProfileChart } from "./LinkProfileChart";
import { MapView } from "./MapView";
import { OnboardingTutorialModal } from "./OnboardingTutorialModal";
import { Sidebar } from "./Sidebar";
import { UserAdminPanel } from "./UserAdminPanel";

const ONBOARDING_SEEN_KEY_PREFIX = "linksim:onboarding-seen:v1:";

export function AppShell() {
  const srtmTilesCount = useAppStore((state) => state.srtmTiles.length);
  const recommendAndFetchTerrainForCurrentArea = useAppStore(
    (state) => state.recommendAndFetchTerrainForCurrentArea,
  );
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [accessState, setAccessState] = useState<"checking" | "granted" | "pending" | "locked">("checking");
  const [activeUserId, setActiveUserId] = useState("");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const { theme, variant } = useThemeVariant();
  const runtimeEnvironment = getCurrentRuntimeEnvironment();
  const envBadgeLabel = runtimeEnvironment === "local" ? "LOCAL" : runtimeEnvironment === "staging" ? "STAGING" : "";

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
        const me = await fetchMe();
        setActiveUserId(me.id);
        try {
          const seen = localStorage.getItem(`${ONBOARDING_SEEN_KEY_PREFIX}${me.id}`);
          if (!seen) setShowOnboarding(true);
        } catch {
          // ignore storage errors
        }
        if (me.accountState === "revoked") {
          setAccessState("locked");
          return;
        }
        setAccessState(me.isAdmin || me.isModerator || me.isApproved ? "granted" : "pending");
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

  const closeOnboarding = () => {
    setShowOnboarding(false);
    if (!activeUserId) return;
    try {
      localStorage.setItem(`${ONBOARDING_SEEN_KEY_PREFIX}${activeUserId}`, "1");
    } catch {
      // ignore storage errors
    }
  };

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
    <main className={`app-shell ${isMapExpanded ? "is-map-expanded" : ""}`}>
      {!isMapExpanded ? <Sidebar /> : null}
      <section className={`workspace-panel ${isMapExpanded ? "is-map-expanded" : ""}`}>
        <MapView isMapExpanded={isMapExpanded} onToggleMapExpanded={() => setIsMapExpanded((prev) => !prev)} />
        {!isMapExpanded ? <LinkProfileChart /> : null}
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
