import { describe, expect, it } from "vitest";

import { getUiErrorMessage } from "./uiError";

describe("getUiErrorMessage", () => {
  it.each(["Load failed", "Failed to fetch", "NetworkError when attempting to fetch resource."])(
    "replaces raw browser transport text with a useful recovery step: %s",
    (message) => {
      expect(getUiErrorMessage(new TypeError(message))).toBe(
        "LinkSim could not reach the service. Check your connection, reload the page, and try again.",
      );
    },
  );

  it("uses an actionable fallback when no safe detail is available", () => {
    expect(getUiErrorMessage("")).toBe("LinkSim could not complete that action. Try again.");
  });

  it("keeps a specific safe application error", () => {
    expect(getUiErrorMessage(new Error("A name is required."))).toBe("A name is required.");
  });
});
