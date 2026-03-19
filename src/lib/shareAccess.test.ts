import { describe, expect, it } from "vitest";
import { shouldOpenShareModal } from "./shareAccess";

describe("shouldOpenShareModal", () => {
  it("opens modal for private simulations", () => {
    expect(shouldOpenShareModal("private", 0)).toBe(true);
  });

  it("opens modal when shared simulation references private sites", () => {
    expect(shouldOpenShareModal("shared", 1)).toBe(true);
  });

  it("does not open modal for shared simulation without private sites", () => {
    expect(shouldOpenShareModal("shared", 0)).toBe(false);
  });

  it("does not open modal for public simulation without private sites", () => {
    expect(shouldOpenShareModal("public", 0)).toBe(false);
  });
});
