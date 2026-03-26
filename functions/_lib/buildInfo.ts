export const APP_VERSION = "0.10.3";
export const APP_COMMIT = "d4ece8e8";
export const APP_BUILD_LABEL = `v${APP_VERSION}+${APP_COMMIT}`;
export type BuildChannel = "stable" | "beta" | "alpha";
export const buildLabelForChannel = (channel: BuildChannel): string => {
  if (channel === "stable") return `v${APP_VERSION}`;
  return `v${APP_VERSION}-${channel}+${APP_COMMIT}`;
};
