import { useEffect } from "react";
import { t } from "../i18n/locales";
import { useSystemTheme } from "../hooks/useSystemTheme";
import { useAppStore } from "../store/appStore";
import { PRIMARY_ATTRIBUTION } from "../lib/terrainCatalog";
import { LinkProfileChart } from "./LinkProfileChart";
import { MapView } from "./MapView";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const locale = useAppStore((state) => state.locale);
  const srtmTilesCount = useAppStore((state) => state.srtmTiles.length);
  const recommendAndFetchTerrainForCurrentArea = useAppStore(
    (state) => state.recommendAndFetchTerrainForCurrentArea,
  );
  const theme = useSystemTheme();

  useEffect(() => {
    if (srtmTilesCount > 0) return;
    void recommendAndFetchTerrainForCurrentArea();
  }, [recommendAndFetchTerrainForCurrentArea, srtmTilesCount]);

  return (
    <main className="app-shell">
      <Sidebar />
      <section className="workspace-panel">
        <header className="workspace-header">
          <h2>{t(locale, "networkCoverageWorkspace")}</h2>
          <p>
            Best-site overlay colors encode worst-case received level across all configured sites.
          </p>
        </header>
        <MapView />
        <LinkProfileChart />
        <footer className="workspace-attribution">
          <p>
            Inspired by{" "}
            <a href={PRIMARY_ATTRIBUTION.projectUrl} rel="noreferrer" target="_blank">
              {PRIMARY_ATTRIBUTION.projectName}
            </a>{" "}
            by {PRIMARY_ATTRIBUTION.authorName}. {PRIMARY_ATTRIBUTION.disclaimer}
          </p>
          <p>
            Basemap style: {theme === "dark" ? "Carto Dark Matter" : "Carto Positron"} (attribution applies).
          </p>
        </footer>
      </section>
    </main>
  );
}
