import { useEffect } from "react";
import { t } from "../i18n/locales";
import { useAppStore } from "../store/appStore";
import { LinkProfileChart } from "./LinkProfileChart";
import { MapView } from "./MapView";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const locale = useAppStore((state) => state.locale);
  const loadBundledSrtmTiles = useAppStore((state) => state.loadBundledSrtmTiles);

  useEffect(() => {
    void loadBundledSrtmTiles();
  }, [loadBundledSrtmTiles]);

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
      </section>
    </main>
  );
}
