export type DeepLinkApplyOutcome = "idle" | "succeeded" | "failed";

type AuthSessionMarkerStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const AUTHENTICATED_SESSION_MARKER_KEY = "linksim:had-authenticated-session:v1";

const getAuthSessionMarkerStorage = (): AuthSessionMarkerStorage | null => {
  if (typeof localStorage === "undefined") return null;
  return localStorage;
};

export const hasAuthenticatedSessionMarker = (
  storage: AuthSessionMarkerStorage | null = getAuthSessionMarkerStorage(),
): boolean => {
  try {
    return storage?.getItem(AUTHENTICATED_SESSION_MARKER_KEY) === "1";
  } catch {
    return false;
  }
};

export const markAuthenticatedSession = (
  storage: AuthSessionMarkerStorage | null = getAuthSessionMarkerStorage(),
): void => {
  try {
    storage?.setItem(AUTHENTICATED_SESSION_MARKER_KEY, "1");
  } catch {
    // Authentication must still work when storage is blocked.
  }
};

export const clearAuthenticatedSessionMarker = (
  storage: AuthSessionMarkerStorage | null = getAuthSessionMarkerStorage(),
): void => {
  try {
    storage?.removeItem(AUTHENTICATED_SESSION_MARKER_KEY);
  } catch {
    // Sign-out must still continue when storage is blocked.
  }
};

export type AuthBootstrapState = "guest" | "expired" | "authenticated" | "revoked";

export const resolveAuthBootstrapState = (input: {
  authState: "guest" | "authenticated" | "revoked";
  hadAuthenticatedSession: boolean;
}): AuthBootstrapState => {
  if (input.authState === "guest" && input.hadAuthenticatedSession) return "expired";
  return input.authState;
};

export const shouldRewritePathAfterDeepLinkApply = (input: {
  deepLinkApplied: boolean;
  deepLinkParseOk: boolean;
  deepLinkApplyOutcome: DeepLinkApplyOutcome;
}): boolean => {
  if (!input.deepLinkApplied) return false;
  if (input.deepLinkParseOk && input.deepLinkApplyOutcome !== "succeeded") return false;
  return true;
};

export const isAuthSignInRequiredMessage = (message: string | null | undefined): boolean => {
  const normalized = String(message ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes("signed out") ||
    normalized.includes("sign in to continue") ||
    normalized.includes("unauthorized") ||
    normalized.includes("forbidden") ||
    normalized.includes("load failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("cloudflare access") ||
    normalized.includes("unexpected token <") ||
    normalized.includes("authentication required") ||
    normalized.includes("not authenticated")
  );
};

export const shouldCloseSimulationLibraryOnLoad = (input: { presetId: string | null | undefined }): boolean =>
  String(input.presetId ?? "").trim().length > 0;
