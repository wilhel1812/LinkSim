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
  const setSyncStatus = useAppStore((state) => state.setSyncStatus);
  const setLastSyncedAt = useAppStore((state) => state.setLastSyncedAt);
  const setSyncErrorMessage = useAppStore((state) => state.setSyncErrorMessage);
  const syncTrigger = useAppStore((state) => state.syncTrigger);
  const [status, setStatus] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const hydrated = useRef(false);
  const syncTimer = useRef<number | null>(null);
  const triggerRef = useRef(syncTrigger);

  const cloudPayload = useMemo(
    () => ({
      siteLibrary,
      simulationPresets,
    }),
    [siteLibrary, simulationPresets],
  );

  const refreshFromCloud = async () => {
    const applyStartupSelection = !hydrated.current;
    console.log("[AuthSyncPanel] refreshFromCloud called, applyStartupSelection:", applyStartupSelection);
    setSyncBusy(true);
    setSyncStatus("syncing");
    try {
      console.log("[AuthSyncPanel] Fetching from cloud...");
      const cloud = await fetchCloudLibrary();
      console.log("[AuthSyncPanel] Cloud data received:", cloud.siteLibrary.length, "sites,", cloud.simulationPresets.length, "simulations");
      const cloudPresets =
        (cloud.simulationPresets as Parameters<typeof importLibraryData>[0]["simulationPresets"] | undefined) ?? [];
      const result = importLibraryData(
        {
          siteLibrary: cloud.siteLibrary as Parameters<typeof importLibraryData>[0]["siteLibrary"],
          simulationPresets: cloudPresets,
        },
        "merge",
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
        `Cloud sync loaded (merge). Delta: ${result.siteCount >= 0 ? "+" : ""}${result.siteCount} site(s), ${result.simulationCount >= 0 ? "+" : ""}${result.simulationCount} simulation(s).`,
      );
      setSyncStatus("synced");
      setLastSyncedAt(new Date().toISOString());
      setSyncErrorMessage(null);
      hydrated.current = true;
      console.log("[AuthSyncPanel] Sync completed successfully");
    } catch (error) {
      console.error("[AuthSyncPanel] Sync failed:", error);
      setSyncStatus("error");
      const message = getUiErrorMessage(error);
      setSyncErrorMessage(message);
      setStatus(`Cloud load failed: ${message}`);
    } finally {
      setSyncBusy(false);
    }
  };

  const manualSync = async () => {
    setSyncBusy(true);
    setSyncStatus("syncing");
    console.log("[AuthSyncPanel] Manual sync: pushing local changes to cloud...");
    try {
      await pushCloudLibrary(cloudPayload);
      console.log("[AuthSyncPanel] Push successful, fetching cloud data...");
      const cloud = await fetchCloudLibrary();
      console.log("[AuthSyncPanel] Cloud data received:", cloud.siteLibrary.length, "sites,", cloud.simulationPresets.length, "simulations");
      const cloudPresets =
        (cloud.simulationPresets as Parameters<typeof importLibraryData>[0]["simulationPresets"] | undefined) ?? [];
      const result = importLibraryData(
        {
          siteLibrary: cloud.siteLibrary as Parameters<typeof importLibraryData>[0]["siteLibrary"],
          simulationPresets: cloudPresets,
        },
        "merge",
      );
      setStatus(
        `Sync complete. Delta: ${result.siteCount >= 0 ? "+" : ""}${result.siteCount} site(s), ${result.simulationCount >= 0 ? "+" : ""}${result.simulationCount} simulation(s).`,
      );
      setSyncStatus("synced");
      setLastSyncedAt(new Date().toISOString());
      setSyncErrorMessage(null);
      console.log("[AuthSyncPanel] Manual sync completed successfully");
    } catch (error) {
      console.error("[AuthSyncPanel] Manual sync failed:", error);
      setSyncStatus("error");
      const message = getUiErrorMessage(error);
      setSyncErrorMessage(message);
      setStatus(`Sync failed: ${message}`);
    } finally {
      setSyncBusy(false);
    }
  };

  useEffect(() => {
    if (hydrated.current) {
      console.log("[AuthSyncPanel] Already hydrated, skipping initial fetch");
      return;
    }
    console.log("[AuthSyncPanel] Initial cloud fetch on mount");
    void refreshFromCloud().catch((error) => {
      const message = getUiErrorMessage(error);
      console.error("[AuthSyncPanel] Initial fetch failed:", message);
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
      console.log("[AuthSyncPanel] Auto-sync timer fired, pushing to cloud...");
      setSyncStatus("syncing");
      void (async () => {
        try {
          await pushCloudLibrary(cloudPayload);
          console.log("[AuthSyncPanel] Push to cloud successful");
          setSyncStatus("synced");
          setLastSyncedAt(new Date().toISOString());
          setSyncErrorMessage(null);
          setStatus(`Cloud sync updated at ${new Date().toLocaleTimeString()}.`);
        } catch (error) {
          console.error("[AuthSyncPanel] Push to cloud failed:", error);
          setSyncStatus("error");
          const message = getUiErrorMessage(error);
          setSyncErrorMessage(message);
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

  useEffect(() => {
    if (syncTrigger === triggerRef.current) return;
    triggerRef.current = syncTrigger;
    console.log("[AuthSyncPanel] Manual sync triggered");
    void manualSync();
  }, [syncTrigger]);

  return (
    <div className="auth-sync-panel">
      <div className="chip-group">
        <button className="inline-action" disabled={syncBusy} onClick={() => void manualSync()} type="button">
          {syncBusy ? "Syncing..." : "Sync From Cloud"}
        </button>
      </div>
      {status ? <p className="field-help">{status}</p> : null}
    </div>
  );
}
