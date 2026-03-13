const PROD_HOSTS = new Set(["linksim.wilhelmfrancke.com", "linksim.pages.dev"]);

const normalizeHost = (host: string): string => host.trim().toLowerCase();

export const isProductionHostname = (hostname: string): boolean => PROD_HOSTS.has(normalizeHost(hostname));

export const isTestEnvironmentHostname = (hostname: string): boolean => !isProductionHostname(hostname);

export const isCurrentTestEnvironment = (): boolean => {
  if (typeof window === "undefined") return false;
  return isTestEnvironmentHostname(window.location.hostname);
};

