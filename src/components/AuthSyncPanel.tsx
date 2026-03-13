import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCloudLibrary, pushCloudLibrary } from "../lib/cloudLibrary";
import { getUiErrorMessage } from "../lib/uiError";
import { useAppStore } from "../store/appStore";

const SYNC_DEBOUNCE_MS = 1200;
const LAST_SIMULATION_REF_KEY = "rmw-last-simulation-ref-v1";

export function AuthSyncPanel() {
  const siteLibrary = useAppStore((state) => state.siteLibrary);
  const simulationPresets = useAppStore((state) => state.simulationPresets);
  const importLibraryData = useAppStore((state) => state.importLibraryData);
  const loadSimulationPreset = useAppStore((state) => state.loadSimulationPreset);
  const selectScenario = useAppStore((state) => state.selectScenario);
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
    const applyStartupSelection = !hydrated.current;
    setSyncBusy(true);
    try {
      const cloud = await fetchCloudLibrary();
      const cloudPresets =
        (cloud.simulationPresets as Parameters<typeof importLibraryData>[0]["simulationPresets"] | undefined) ?? [];
      const result = importLibraryData(
        {
          siteLibrary: cloud.siteLibrary as Parameters<typeof importLibraryData>[0]["siteLibrary"],
          simulationPresets: cloudPresets,
        },
        "replace",
      );
      if (applyStartupSelection && typeof window !== "undefined") {
        const lastRefRaw = window.localStorage.getItem(LAST_SIMULATION_REF_KEY);
        const lastRef = (lastRefRaw ?? "").trim();
        if (lastRef.startsWith("saved:")) {
          const presetId = lastRef.slice("saved:".length);
          if (presetId && cloudPresets.some((preset) => preset.id === presetId)) {
            loadSimulationPreset(presetId);
          }
        } else if (lastRef.startsWith("builtin:")) {
          const scenarioId = lastRef.slice("builtin:".length);
          if (scenarioId) selectScenario(scenarioId);
        }
      }
      setStatus(
        `Cloud sync loaded (replace). Delta: ${result.siteCount >= 0 ? "+" : ""}${result.siteCount} site(s), ${result.simulationCount >= 0 ? "+" : ""}${result.simulationCount} simulation(s).`,
      );
      hydrated.current = true;
    } finally {
      setSyncBusy(false);
    }
  };

  useEffect(() => {
    if (hydrated.current) return;
    void refreshFromCloud().catch((error) => {
      const message = getUiErrorMessage(error);
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
          const message = getUiErrorMessage(error);
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
