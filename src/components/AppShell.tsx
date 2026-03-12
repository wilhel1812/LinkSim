import { useEffect, useState } from "react";
import { fetchMe } from "../lib/cloudUser";
import { getUiErrorMessage } from "../lib/uiError";
import { useAppStore } from "../store/appStore";
import { LinkProfileChart } from "./LinkProfileChart";
import { MapView } from "./MapView";
import { Sidebar } from "./Sidebar";
import { UserAdminPanel } from "./UserAdminPanel";

export function AppShell() {
  const srtmTilesCount = useAppStore((state) => state.srtmTiles.length);
  const recommendAndFetchTerrainForCurrentArea = useAppStore(
    (state) => state.recommendAndFetchTerrainForCurrentArea,
  );
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  const [accessState, setAccessState] = useState<"checking" | "granted" | "pending" | "locked">("checking");

  useEffect(() => {
    if (srtmTilesCount > 0) return;
    void recommendAndFetchTerrainForCurrentArea();
  }, [recommendAndFetchTerrainForCurrentArea, srtmTilesCount]);

  useEffect(() => {
    void (async () => {
      try {
        const me = await fetchMe();
        if (me.accountState === "revoked") {
          setAccessState("locked");
          return;
        }
        setAccessState(me.isAdmin || me.isApproved ? "granted" : "pending");
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
          <h2>Account Pending Approval</h2>
          <p className="field-help">
            You can sign in and edit your profile, but simulation tools stay locked until an admin approves your access.
          </p>
          <p className="field-help">To continue:</p>
          <ul className="field-help access-pending-list">
            <li>Open User Settings.</li>
            <li>Add your name and valid email address.</li>
            <li>Optionally add an access request note to explain why you need access.</li>
            <li>Wait for admin approval. You will keep profile access while pending.</li>
          </ul>
        </section>
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
    </main>
  );
}
