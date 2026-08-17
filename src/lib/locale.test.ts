import { describe, expect, it } from "vitest";
import { formatCompactCount } from "./locale";

describe("formatCompactCount", () => {
  it("keeps small counts exact and compacts large grid counts with k/M/G suffixes", () => {
    expect(formatCompactCount(999)).toBe("999");
    expect(formatCompactCount(100_489)).toBe("100.5k");
    expect(formatCompactCount(1_960_000)).toBe("1.96M");
    expect(formatCompactCount(1_250_000_000)).toBe("1.25G");
  });
});
