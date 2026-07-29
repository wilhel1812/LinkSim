export type SyncIndicatorState = "local" | "offline" | "pending" | "syncing" | "synced" | "error";

export type SyncIndicator = {
  state: SyncIndicatorState;
  className: string;
  label: string;
  title: string;
};

type Input = {
  isLocalRuntime: boolean;
  isOnline: boolean;
  authState: "checking" | "signed_in" | "signed_out";
  syncStatus: "syncing" | "synced" | "error";
  syncPending: boolean;
  pendingChangesCount: number;
  syncErrorMessage: string | null;
  lastSyncedAt: string | null;
};

export const deriveSyncIndicator = (input: Input): SyncIndicator => {
  const lastSyncedTime = input.lastSyncedAt
    ? new Date(input.lastSyncedAt).toLocaleTimeString()
    : null;
  const lastSyncLabel = lastSyncedTime
    ? `Last synced: ${lastSyncedTime}`
    : "Last synced: Never";
  const upToDateLabel = lastSyncedTime
    ? `Up to date (synced ${lastSyncedTime})`
    : "Up to date";

  if (input.isLocalRuntime) {
    return { state: "local", className: "sync-local", label: "Local mode", title: "Local mode - no cloud sync available" };
  }

  if (!input.isOnline) {
    return {
      state: "offline",
      className: "sync-offline",
      label: "Offline",
      title: `Offline. ${input.pendingChangesCount} pending change${input.pendingChangesCount === 1 ? "" : "s"}. Open Sync Status for details.`,
    };
  }

  if (input.authState === "signed_out") {
    return {
      state: "error",
      className: "sync-error",
      label: "Sync failed",
      title: "Not signed in; cloud sync unavailable. Sign in and open Sync Status to recover pending changes.",
    };
  }

  if (input.syncStatus === "error") {
    return {
      state: "error",
      className: "sync-error",
      label: "Sync failed",
      title: `Sync failed. ${lastSyncLabel}. ${input.syncErrorMessage ?? "Open Sync Status for details."}`,
    };
  }

  if (input.syncPending) {
    return {
      state: "pending",
      className: "sync-pending",
      label: "Sync pending",
      title: `Sync pending. ${lastSyncLabel}. ${input.pendingChangesCount} pending change${input.pendingChangesCount === 1 ? "" : "s"}.`,
    };
  }

  switch (input.syncStatus) {
    case "syncing":
      return { state: "syncing", className: "sync-syncing", label: "Syncing...", title: `Syncing... ${lastSyncLabel}.` };
    case "synced":
      return { state: "synced", className: "sync-synced", label: "Up to date", title: `${upToDateLabel}. Click for details.` };
    default:
      return { state: "synced", className: "sync-synced", label: "Up to date", title: `${upToDateLabel}. Click for details.` };
  }
};
