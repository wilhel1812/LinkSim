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
