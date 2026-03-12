import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCloudLibrary, pushCloudLibrary } from "../lib/cloudLibrary";
import { useAppStore } from "../store/appStore";

const SYNC_DEBOUNCE_MS = 1200;

export function AuthSyncPanel() {
  const siteLibrary = useAppStore((state) => state.siteLibrary);
  const simulationPresets = useAppStore((state) => state.simulationPresets);
  const importLibraryData = useAppStore((state) => state.importLibraryData);
  const [status, setStatus] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const hydrated = useRef(false);
  const syncTimer = useRef<number | null>(null);

  const cloudPayload = useMemo(
    () => ({
      siteLibrary,
      simulationPresets,
    }),
    [siteLibrary, simulationPresets],
  );

  const refreshFromCloud = async () => {
    setSyncBusy(true);
    try {
      const cloud = await fetchCloudLibrary();
      const result = importLibraryData(
        {
          siteLibrary: cloud.siteLibrary as Parameters<typeof importLibraryData>[0]["siteLibrary"],
          simulationPresets: cloud.simulationPresets as Parameters<typeof importLibraryData>[0]["simulationPresets"],
        },
        "merge",
      );
      setStatus(
        `Cloud sync loaded. Delta: ${result.siteCount >= 0 ? "+" : ""}${result.siteCount} site(s), ${result.simulationCount >= 0 ? "+" : ""}${result.simulationCount} simulation(s).`,
      );
      hydrated.current = true;
    } finally {
      setSyncBusy(false);
    }
  };

  useEffect(() => {
    if (hydrated.current) return;
    void refreshFromCloud().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Cloud load failed: ${message}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;

    if (syncTimer.current) {
      window.clearTimeout(syncTimer.current);
    }
    syncTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          await pushCloudLibrary(cloudPayload);
          setStatus(`Cloud sync updated at ${new Date().toLocaleTimeString()}.`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setStatus(`Cloud save failed: ${message}`);
        }
      })();
    }, SYNC_DEBOUNCE_MS);

    return () => {
      if (syncTimer.current) {
        window.clearTimeout(syncTimer.current);
        syncTimer.current = null;
      }
    };
  }, [cloudPayload]);

  return (
    <div className="auth-sync-panel">
      <div className="chip-group">
        <button className="inline-action" disabled={syncBusy} onClick={() => void refreshFromCloud()} type="button">
          {syncBusy ? "Syncing..." : "Sync From Cloud"}
        </button>
      </div>
      {status ? <p className="field-help">{status}</p> : null}
    </div>
  );
}
