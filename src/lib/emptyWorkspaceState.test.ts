import { describe, expect, it } from "vitest";

import { emptyWorkspaceState } from "./emptyWorkspaceState";

describe("emptyWorkspaceState", () => {
  it("returns no-simulation when no sites and no active simulation", () => {
    expect(emptyWorkspaceState(0, false)).toBe("no-simulation");
  });

  it("returns blank-simulation when no sites but a simulation is active", () => {
    expect(emptyWorkspaceState(0, true)).toBe("blank-simulation");
  });

  it("returns ready when one or more sites exist", () => {
    expect(emptyWorkspaceState(1, false)).toBe("ready");
    expect(emptyWorkspaceState(2, true)).toBe("ready");
  });
});
