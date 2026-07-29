import { describe, expect, it } from "vitest";
import { deriveSyncIndicator } from "./syncIndicator";

describe("deriveSyncIndicator", () => {
  const lastSyncedAt = "2026-07-29T10:42:40.000Z";
  const lastSyncedTime = new Date(lastSyncedAt).toLocaleTimeString();
  const baseInput: Parameters<typeof deriveSyncIndicator>[0] = {
    isLocalRuntime: false,
    isOnline: true,
    authState: "signed_in",
    syncStatus: "synced",
    syncPending: false,
    pendingChangesCount: 0,
    syncErrorMessage: null,
    lastSyncedAt: null,
  };

  it.each([
    {
      name: "local mode overrides cloud state",
      input: {
        isLocalRuntime: true,
        isOnline: false,
        authState: "signed_out" as const,
        syncStatus: "error" as const,
        syncPending: true,
        pendingChangesCount: 3,
      },
      expected: {
        state: "local",
        className: "sync-local",
        label: "Local mode",
        title: "Local mode - no cloud sync available",
      },
    },
    {
      name: "offline state reports plural pending changes",
      input: {
        isOnline: false,
        authState: "signed_out" as const,
        syncStatus: "error" as const,
        syncPending: true,
        pendingChangesCount: 2,
      },
      expected: {
        state: "offline",
        className: "sync-offline",
        label: "Offline",
        title: "Offline. 2 pending changes. Open Sync Status for details.",
      },
    },
    {
      name: "signed-out state reports unavailable cloud sync",
      input: {
        authState: "signed_out" as const,
        syncPending: true,
        pendingChangesCount: 1,
      },
      expected: {
        state: "error",
        className: "sync-error",
        label: "Sync failed",
        title: "Not signed in; cloud sync unavailable. Sign in and open Sync Status to recover pending changes.",
      },
    },
    {
      name: "sync error overrides pending and keeps last-sync context",
      input: {
        syncStatus: "error" as const,
        syncPending: true,
        pendingChangesCount: 3,
        syncErrorMessage: "401 Unauthorized",
        lastSyncedAt,
      },
      expected: {
        state: "error",
        className: "sync-error",
        label: "Sync failed",
        title: `Sync failed. Last synced: ${lastSyncedTime}. 401 Unauthorized`,
      },
    },
    {
      name: "pending state reports a singular change and last-sync context",
      input: {
        syncPending: true,
        pendingChangesCount: 1,
        lastSyncedAt,
      },
      expected: {
        state: "pending",
        className: "sync-pending",
        label: "Sync pending",
        title: `Sync pending. Last synced: ${lastSyncedTime}. 1 pending change.`,
      },
    },
    {
      name: "pending state reports that no sync has completed yet",
      input: {
        syncPending: true,
        pendingChangesCount: 2,
      },
      expected: {
        state: "pending",
        className: "sync-pending",
        label: "Sync pending",
        title: "Sync pending. Last synced: Never. 2 pending changes.",
      },
    },
    {
      name: "syncing state leads with its current state",
      input: {
        syncStatus: "syncing" as const,
        lastSyncedAt,
      },
      expected: {
        state: "syncing",
        className: "sync-syncing",
        label: "Syncing...",
        title: `Syncing... Last synced: ${lastSyncedTime}.`,
      },
    },
    {
      name: "synced state remains up to date",
      input: {
        lastSyncedAt,
      },
      expected: {
        state: "synced",
        className: "sync-synced",
        label: "Up to date",
        title: `Up to date (synced ${lastSyncedTime}). Click for details.`,
      },
    },
  ])("$name", ({ input, expected }) => {
    expect(deriveSyncIndicator({ ...baseInput, ...input })).toEqual(expected);
  });
});
