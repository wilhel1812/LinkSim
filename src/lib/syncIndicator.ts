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
  const timeLabel = input.lastSyncedAt
    ? `Up to date (synced ${new Date(input.lastSyncedAt).toLocaleTimeString()})`
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
      title: `${timeLabel}. ${input.syncErrorMessage ?? "Open Sync Status for details."}`,
    };
  }

  if (input.syncPending) {
    return {
      state: "pending",
      className: "sync-pending",
      label: "Sync pending",
      title: `${timeLabel}. ${input.pendingChangesCount} pending change${input.pendingChangesCount === 1 ? "" : "s"}.`,
    };
  }

  switch (input.syncStatus) {
    case "syncing":
      return { state: "syncing", className: "sync-syncing", label: "Syncing...", title: timeLabel };
    case "synced":
      return { state: "synced", className: "sync-synced", label: "Up to date", title: `${timeLabel}. Click for details.` };
    default:
      return { state: "synced", className: "sync-synced", label: "Up to date", title: `${timeLabel}. Click for details.` };
  }
};
