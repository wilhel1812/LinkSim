import { describe, expect, it } from "vitest";
import {
  AUTHENTICATED_SESSION_MARKER_KEY,
  clearAuthenticatedSessionMarker,
  hasAuthenticatedSessionMarker,
  isAuthSignInRequiredMessage,
  markAuthenticatedSession,
  resolveAuthBootstrapState,
  shouldCloseSimulationLibraryOnLoad,
  shouldRewritePathAfterDeepLinkApply,
} from "./appShellGuards";

describe("shouldRewritePathAfterDeepLinkApply", () => {
  it("rewrites only after successful deep-link apply", () => {
    expect(
      shouldRewritePathAfterDeepLinkApply({
        deepLinkApplied: true,
        deepLinkParseOk: true,
        deepLinkApplyOutcome: "succeeded",
      }),
    ).toBe(true);

    expect(
      shouldRewritePathAfterDeepLinkApply({
        deepLinkApplied: true,
        deepLinkParseOk: true,
        deepLinkApplyOutcome: "failed",
      }),
    ).toBe(false);
  });

  it("allows non-deeplink rewrites once applied", () => {
    expect(
      shouldRewritePathAfterDeepLinkApply({
        deepLinkApplied: true,
        deepLinkParseOk: false,
        deepLinkApplyOutcome: "idle",
      }),
    ).toBe(true);
  });
});

describe("isAuthSignInRequiredMessage", () => {
  it("detects unauthorized or auth-required messages", () => {
    expect(isAuthSignInRequiredMessage("Unauthorized")).toBe(true);
    expect(isAuthSignInRequiredMessage("401 Unauthorized")).toBe(true);
    expect(isAuthSignInRequiredMessage("Authentication required")).toBe(true);
    expect(isAuthSignInRequiredMessage("Load failed")).toBe(true);
    expect(isAuthSignInRequiredMessage("Failed to fetch")).toBe(true);
    expect(isAuthSignInRequiredMessage("Sign in · Cloudflare Access")).toBe(true);
    expect(isAuthSignInRequiredMessage("You are signed out. Sign in to continue.")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isAuthSignInRequiredMessage("Network timeout")).toBe(false);
    expect(isAuthSignInRequiredMessage("NetworkError when attempting to fetch resource.")).toBe(false);
    expect(isAuthSignInRequiredMessage("This shared simulation is unavailable.")).toBe(false);
  });
});

describe("authenticated session marker", () => {
  it("records and clears a prior authenticated session", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };

    expect(hasAuthenticatedSessionMarker(storage)).toBe(false);
    markAuthenticatedSession(storage);
    expect(values.get(AUTHENTICATED_SESSION_MARKER_KEY)).toBe("1");
    expect(hasAuthenticatedSessionMarker(storage)).toBe(true);
    clearAuthenticatedSessionMarker(storage);
    expect(hasAuthenticatedSessionMarker(storage)).toBe(false);
  });

  it("fails safely when storage is unavailable", () => {
    const storage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };

    expect(hasAuthenticatedSessionMarker(storage)).toBe(false);
    expect(() => markAuthenticatedSession(storage)).not.toThrow();
    expect(() => clearAuthenticatedSessionMarker(storage)).not.toThrow();
  });
});

describe("resolveAuthBootstrapState", () => {
  it("distinguishes expected guests from expired sessions", () => {
    expect(resolveAuthBootstrapState({ authState: "guest", hadAuthenticatedSession: false })).toBe("guest");
    expect(resolveAuthBootstrapState({ authState: "guest", hadAuthenticatedSession: true })).toBe("expired");
  });

  it("preserves authenticated and revoked states", () => {
    expect(resolveAuthBootstrapState({ authState: "authenticated", hadAuthenticatedSession: false })).toBe(
      "authenticated",
    );
    expect(resolveAuthBootstrapState({ authState: "revoked", hadAuthenticatedSession: true })).toBe("revoked");
  });
});

describe("shouldCloseSimulationLibraryOnLoad", () => {
  it("closes the simulation library modal after selecting a simulation", () => {
    expect(shouldCloseSimulationLibraryOnLoad({ presetId: "sim-123" })).toBe(true);
  });

  it("does not close for empty simulation selection", () => {
    expect(shouldCloseSimulationLibraryOnLoad({ presetId: "" })).toBe(false);
    expect(shouldCloseSimulationLibraryOnLoad({ presetId: "   " })).toBe(false);
  });
});
