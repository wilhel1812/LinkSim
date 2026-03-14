export const APP_VERSION = "0.9.12";
export const APP_COMMIT = "8d09ee2f";
export const APP_BUILD_LABEL = `v${APP_VERSION}+${APP_COMMIT}`;
export type BuildChannel = "stable" | "beta" | "alpha";
export const buildLabelForChannel = (channel: BuildChannel): string => {
  if (channel === "stable") return `v${APP_VERSION}`;
  return `v${APP_VERSION}-${channel}+${APP_COMMIT}`;
};
