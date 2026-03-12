import { useEffect, useState } from "react";
import { fetchMe } from "../lib/cloudUser";
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
  const [accessState, setAccessState] = useState<"checking" | "granted" | "pending">("checking");

  useEffect(() => {
    if (srtmTilesCount > 0) return;
    void recommendAndFetchTerrainForCurrentArea();
  }, [recommendAndFetchTerrainForCurrentArea, srtmTilesCount]);

  useEffect(() => {
    void (async () => {
      try {
        const me = await fetchMe();
        setAccessState(me.isAdmin || me.isApproved ? "granted" : "pending");
      } catch {
        setAccessState("granted");
      }
    })();
  }, []);

  if (accessState === "pending") {
    return (
      <main className="app-shell access-locked-shell">
        <section className="panel-section access-locked-panel">
          <UserAdminPanel />
          <h2>Account Pending Approval</h2>
          <p className="field-help">
            Complete your profile and add an access request note. An admin must approve your account before you can use
            simulations or libraries.
          </p>
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
