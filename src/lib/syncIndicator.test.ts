import { describe, expect, it } from "vitest";
import { deriveSyncIndicator } from "./syncIndicator";

describe("deriveSyncIndicator", () => {
  it("returns error (red) when sync status is error even if pending is true", () => {
    const indicator = deriveSyncIndicator({
      isLocalRuntime: false,
      isOnline: true,
      authState: "signed_in",
      syncStatus: "error",
      syncPending: true,
      pendingChangesCount: 3,
      syncErrorMessage: "401 Unauthorized",
      lastSyncedAt: null,
    });
    expect(indicator.state).toBe("error");
    expect(indicator.className).toBe("sync-error");
  });

  it("returns error (red) when auth state is signed_out", () => {
    const indicator = deriveSyncIndicator({
      isLocalRuntime: false,
      isOnline: true,
      authState: "signed_out",
      syncStatus: "synced",
      syncPending: true,
      pendingChangesCount: 2,
      syncErrorMessage: null,
      lastSyncedAt: null,
    });
    expect(indicator.state).toBe("error");
    expect(indicator.label).toBe("Sync failed");
    expect(indicator.title).toContain("Not signed in");
  });
});
