import { describe, expect, it } from "vitest";
import { normalizeApiErrorMessage, statusFromErrorMessage } from "./http";

describe("http error normalization", () => {
  it("maps known auth/access errors to stable statuses", () => {
    expect(statusFromErrorMessage("Schema out of date")).toBe(503);
    expect(statusFromErrorMessage("Session revoked by admin")).toBe(401);
    expect(statusFromErrorMessage("Unauthorized")).toBe(401);
    expect(statusFromErrorMessage("Account pending approval")).toBe(403);
    expect(statusFromErrorMessage("Forbidden")).toBe(403);
    expect(statusFromErrorMessage("User not found")).toBe(404);
    expect(statusFromErrorMessage("Name is required")).toBe(400);
  });

  it("normalizes common messages", () => {
    expect(normalizeApiErrorMessage("Unauthorized token")).toBe("Unauthorized.");
    expect(normalizeApiErrorMessage("pending approval for account")).toBe("Account pending approval.");
    expect(normalizeApiErrorMessage("")).toBe("Request failed.");
  });
});
