export type DeepLinkApplyOutcome = "idle" | "succeeded" | "failed";

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

export const shouldUseReadonlyFallbackForAuthBootstrap = (input: {
  message: string | null | undefined;
  deepLinkMode: boolean;
  isLocalRuntime: boolean;
  isOnline: boolean;
  userAgent: string;
}): boolean => {
  if (input.deepLinkMode) return false;
  if (input.isLocalRuntime) return false;
  if (!input.isOnline) return false;
  const normalized = String(input.message ?? "").trim().toLowerCase();
  if (!normalized) return false;
  const isFirefox = /firefox/i.test(input.userAgent);
  if (!isFirefox) return false;
  return normalized.includes("networkerror when attempting to fetch resource");
};

export const shouldCloseSimulationLibraryOnLoad = (input: { presetId: string | null | undefined }): boolean =>
  String(input.presetId ?? "").trim().length > 0;

export const formatPrivateSiteReferenceBlockMessage = (siteNames: string[]): string => {
  const cleaned = siteNames.map((name) => String(name).trim()).filter(Boolean);
  const nameList = cleaned.length ? ` (${cleaned.join(", ")})` : "";
  return `Cannot share this Simulation while private Library Site references exist${nameList}. Set Simulation visibility to Private or use non-private Site entries.`;
};
