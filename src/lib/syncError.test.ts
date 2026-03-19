import { describe, expect, it } from "vitest";
import { toFriendlySyncError } from "./syncError";

describe("toFriendlySyncError", () => {
  it("returns friendly guidance for private-site reference conflicts", () => {
    const message =
      'Cannot publish/shared simulation "Hjemme" because it references private site "Kragstottten". Set simulation to Private or use non-private site entries.';
    const result = toFriendlySyncError(message);
    expect(result).not.toBeNull();
    expect(result?.summary).toContain('Simulation "Hjemme" cannot sync');
    expect(result?.summary).toContain('private site "Kragstottten"');
    expect(result?.steps.length).toBe(3);
  });

  it("returns null for unrelated errors", () => {
    expect(toFriendlySyncError("Network timeout while syncing")).toBeNull();
  });

  it("returns friendly guidance for 403/forbidden sync failures", () => {
    const result = toFriendlySyncError("403 Forbidden: Access denied");
    expect(result).not.toBeNull();
    expect(result?.summary).toContain("write one or more resources");
    expect(result?.steps.length).toBe(3);
  });
});
