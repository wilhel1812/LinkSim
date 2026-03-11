import { useEffect, useState } from "react";
import { useAppStore } from "../store/appStore";
import { LinkProfileChart } from "./LinkProfileChart";
import { MapView } from "./MapView";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const srtmTilesCount = useAppStore((state) => state.srtmTiles.length);
  const recommendAndFetchTerrainForCurrentArea = useAppStore(
    (state) => state.recommendAndFetchTerrainForCurrentArea,
  );
  const [isMapExpanded, setIsMapExpanded] = useState(false);

  useEffect(() => {
    if (srtmTilesCount > 0) return;
    void recommendAndFetchTerrainForCurrentArea();
  }, [recommendAndFetchTerrainForCurrentArea, srtmTilesCount]);

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
