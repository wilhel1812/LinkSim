import { SignInButton, SignOutButton, UserButton, useAuth } from "@clerk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCloudLibrary, pushCloudLibrary } from "../lib/cloudLibrary";
import { useAppStore } from "../store/appStore";

const SYNC_DEBOUNCE_MS = 1200;

export function AuthSyncPanel() {
  const enabled = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
  const siteLibrary = useAppStore((state) => state.siteLibrary);
  const simulationPresets = useAppStore((state) => state.simulationPresets);
  const importLibraryData = useAppStore((state) => state.importLibraryData);
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const [status, setStatus] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const hydratedUserId = useRef<string | null>(null);
  const syncTimer = useRef<number | null>(null);

  const cloudPayload = useMemo(
    () => ({
      siteLibrary,
      simulationPresets,
    }),
    [siteLibrary, simulationPresets],
  );

  const refreshFromCloud = useCallback(async () => {
    if (!isSignedIn || !userId) return;
    const token = await getToken();
    if (!token) throw new Error("No auth token available");
    setSyncBusy(true);
    try {
      const cloud = await fetchCloudLibrary(token);
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
      hydratedUserId.current = userId;
    } finally {
      setSyncBusy(false);
    }
  }, [getToken, importLibraryData, isSignedIn, userId]);

  useEffect(() => {
    if (!enabled || !isLoaded || !isSignedIn || !userId) return;
    if (hydratedUserId.current === userId) return;
    void refreshFromCloud().catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Cloud load failed: ${message}`);
    });
  }, [enabled, isLoaded, isSignedIn, userId, refreshFromCloud]);

  useEffect(() => {
    if (!enabled || !isLoaded || !isSignedIn || !userId) return;
    if (hydratedUserId.current !== userId) return;

    if (syncTimer.current) {
      window.clearTimeout(syncTimer.current);
    }
    syncTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const token = await getToken();
          if (!token) return;
          await pushCloudLibrary(token, cloudPayload);
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
  }, [enabled, isLoaded, isSignedIn, userId, cloudPayload, getToken]);

  if (!enabled) {
    return <p className="field-help">Cloud auth disabled (missing `VITE_CLERK_PUBLISHABLE_KEY`).</p>;
  }

  return (
    <div className="auth-sync-panel">
      <div className="chip-group">
        {isSignedIn ? (
          <>
            <button className="inline-action" disabled={syncBusy} onClick={() => void refreshFromCloud()} type="button">
              {syncBusy ? "Syncing..." : "Sync From Cloud"}
            </button>
            <SignOutButton>
              <button className="inline-action" type="button">
                Sign Out
              </button>
            </SignOutButton>
            <UserButton />
          </>
        ) : (
          <SignInButton mode="modal">
            <button className="inline-action" type="button">
              Sign In
            </button>
          </SignInButton>
        )}
      </div>
      {status ? <p className="field-help">{status}</p> : null}
    </div>
  );
}
