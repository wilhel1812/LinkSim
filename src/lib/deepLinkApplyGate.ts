export type DeepLinkApplyAccessState = "checking" | "granted" | "readonly" | "pending" | "locked";

export const canRunDeepLinkApply = (input: {
  accessState: DeepLinkApplyAccessState;
  deepLinkAlreadyApplied: boolean;
  isInitializing: boolean;
  cloudInitSettled: boolean;
}): boolean => {
  if ((input.accessState !== "granted" && input.accessState !== "readonly") || input.deepLinkAlreadyApplied || input.isInitializing) {
    return false;
  }
  if (input.accessState === "granted" && !input.cloudInitSettled) {
    return false;
  }
  return true;
};
