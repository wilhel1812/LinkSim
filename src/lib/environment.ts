export type RuntimeEnvironment = "local" | "staging" | "production";

const PROD_HOSTS = new Set(["linksim.wilhelmfrancke.com", "linksim.pages.dev"]);

const normalizeHost = (host: string): string => host.trim().toLowerCase();

export const isProductionHostname = (hostname: string): boolean => PROD_HOSTS.has(normalizeHost(hostname));

export const isLocalHostname = (hostname: string): boolean => {
  const host = normalizeHost(hostname);
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
};

export const runtimeEnvironmentForHostname = (hostname: string): RuntimeEnvironment => {
  if (isLocalHostname(hostname)) return "local";
  if (isProductionHostname(hostname)) return "production";
  return "staging";
};

export const getCurrentRuntimeEnvironment = (): RuntimeEnvironment => {
  if (typeof window === "undefined") return "production";
  return runtimeEnvironmentForHostname(window.location.hostname);
};

export const isTestEnvironmentHostname = (hostname: string): boolean => !isProductionHostname(hostname);

export const isCurrentTestEnvironment = (): boolean => {
  return getCurrentRuntimeEnvironment() !== "production";
};
