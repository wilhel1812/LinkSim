import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCloudLibrary, pushCloudLibrary } from "../lib/cloudLibrary";
import { getUiErrorMessage } from "../lib/uiError";
import { useAppStore } from "../store/appStore";

const SYNC_DEBOUNCE_MS = 1200;
const LAST_SIMULATION_REF_KEY = "rmw-last-simulation-ref-v1";

const logPayload = (label: string, payload: { siteLibrary: unknown[]; simulationPresets: unknown[] }) => {
  console.log(`[AuthSyncPanel] ${label}:`, {
    sites: payload.siteLibrary.length,
    simulations: payload.simulationPresets.length,
    payloadSize: JSON.stringify(payload).length,
  });
};

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
    console.log("[AuthSyncPanel] refreshFromCloud START - applyStartupSelection:", applyStartupSelection);
    setSyncBusy(true);
    setSyncStatus("syncing");
    try {
      console.log("[AuthSyncPanel] Fetching cloud library...");
      const cloud = await fetchCloudLibrary();
      logPayload("[AuthSyncPanel] Cloud data received", cloud);
      const cloudPresets =
        (cloud.simulationPresets as Parameters<typeof importLibraryData>[0]["simulationPresets"] | undefined) ?? [];
      console.log("[AuthSyncPanel] Merging cloud data with local...");
      const result = importLibraryData(
        {
          siteLibrary: cloud.siteLibrary as Parameters<typeof importLibraryData>[0]["siteLibrary"],
          simulationPresets: cloudPresets,
        },
        "merge",
      );
      console.log("[AuthSyncPanel] Merge result:", result);
      if (applyStartupSelection && typeof window !== "undefined") {
        const lastRefRaw = window.localStorage.getItem(LAST_SIMULATION_REF_KEY);
        const lastRef = (lastRefRaw ?? "").trim();
        if (lastRef.startsWith("saved:")) {
          const presetId = lastRef.slice("saved:".length);
          if (presetId && cloudPresets.some((preset) => preset.id === presetId)) {
            console.log("[AuthSyncPanel] Restoring last simulation:", presetId);
            loadSimulationPreset(presetId);
          }
        } else if (lastRef.startsWith("builtin:")) {
          const scenarioId = lastRef.slice("builtin:".length);
          if (scenarioId) {
            console.log("[AuthSyncPanel] Restoring last scenario:", scenarioId);
            selectScenario(scenarioId);
          }
        }
      }
      setStatus(
        `Cloud sync loaded (merge). Delta: ${result.siteCount >= 0 ? "+" : ""}${result.siteCount} site(s), ${result.simulationCount >= 0 ? "+" : ""}${result.simulationCount} simulation(s).`,
      );
      setSyncStatus("synced");
      setLastSyncedAt(new Date().toISOString());
      setSyncErrorMessage(null);
      hydrated.current = true;
      console.log("[AuthSyncPanel] refreshFromCloud SUCCESS - status: synced, hydrated: true");
    } catch (error) {
      console.error("[AuthSyncPanel] refreshFromCloud FAILED:", error);
      setSyncStatus("error");
      const message = getUiErrorMessage(error);
      setSyncErrorMessage(message);
      setStatus(`Cloud load failed: ${message}`);
    } finally {
      setSyncBusy(false);
    }
  };

  const manualSync = async () => {
    console.log("[AuthSyncPanel] manualSync START");
    setSyncBusy(true);
    setSyncStatus("syncing");
    try {
      logPayload("[AuthSyncPanel] Pushing local data to cloud", cloudPayload);
      await pushCloudLibrary(cloudPayload);
      console.log("[AuthSyncPanel] Push SUCCESS, fetching cloud data...");
      const cloud = await fetchCloudLibrary();
      logPayload("[AuthSyncPanel] Cloud data received", cloud);
      const cloudPresets =
        (cloud.simulationPresets as Parameters<typeof importLibraryData>[0]["simulationPresets"] | undefined) ?? [];
      console.log("[AuthSyncPanel] Merging cloud data with local...");
      const result = importLibraryData(
        {
          siteLibrary: cloud.siteLibrary as Parameters<typeof importLibraryData>[0]["siteLibrary"],
          simulationPresets: cloudPresets,
        },
        "merge",
      );
      console.log("[AuthSyncPanel] Merge result:", result);
      setStatus(
        `Sync complete. Delta: ${result.siteCount >= 0 ? "+" : ""}${result.siteCount} site(s), ${result.simulationCount >= 0 ? "+" : ""}${result.simulationCount} simulation(s).`,
      );
      setSyncStatus("synced");
      setLastSyncedAt(new Date().toISOString());
      setSyncErrorMessage(null);
      console.log("[AuthSyncPanel] manualSync SUCCESS - status: synced");
    } catch (error) {
      console.error("[AuthSyncPanel] manualSync FAILED:", error);
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
    console.log("[AuthSyncPanel] Running initial fetch from cloud...");
    void refreshFromCloud().catch((error) => {
      const message = getUiErrorMessage(error);
      console.error("[AuthSyncPanel] Initial fetch catch block:", message);
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
          logPayload("[AuthSyncPanel] Auto-push payload", cloudPayload);
          await pushCloudLibrary(cloudPayload);
          console.log("[AuthSyncPanel] Auto-push SUCCESS");
          setSyncStatus("synced");
          setLastSyncedAt(new Date().toISOString());
          setSyncErrorMessage(null);
          setStatus(`Cloud sync updated at ${new Date().toLocaleTimeString()}.`);
        } catch (error) {
          console.error("[AuthSyncPanel] Auto-push FAILED:", error);
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
    console.log("[AuthSyncPanel] Manual sync trigger detected, calling manualSync()");
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
