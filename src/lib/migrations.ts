import { APP_VERSION } from "./buildInfo";
import { clearTerrainLossCache } from "./coverage";

const STORED_VERSION_KEY = "linksim-last-seen-version-v1";

type StoragePolicy = "preserve" | "resetOnVersionChange";

type LocalStorageRule = {
  scope: "localStorage";
  policy: StoragePolicy;
  key?: string;
  prefix?: string;
};

type CacheStorageRule = {
  scope: "cacheStorage";
  policy: StoragePolicy;
  cacheName: string;
};

type MemoryRule = {
  scope: "memory";
  policy: StoragePolicy;
  id: string;
  clear: () => void;
};

type ClientStorageRule = LocalStorageRule | CacheStorageRule | MemoryRule;

const CLIENT_STORAGE_RULES: ClientStorageRule[] = [
  { scope: "localStorage", policy: "preserve", key: "rmw-site-library-v1" },
  { scope: "localStorage", policy: "preserve", key: "rmw-sim-presets-v1" },
  { scope: "localStorage", policy: "preserve", key: "linksim-sync-signature-v1" },
  { scope: "localStorage", policy: "preserve", key: "linksim-last-session-v1" },
  { scope: "localStorage", policy: "preserve", key: "linksim-ui-theme-v1" },
  { scope: "localStorage", policy: "preserve", key: "linksim-ui-color-theme-v1" },
  { scope: "localStorage", policy: "preserve", key: "linksim-basemap-provider-v1" },
  { scope: "localStorage", policy: "preserve", key: "linksim-basemap-style-preset-v1" },
  { scope: "localStorage", policy: "resetOnVersionChange", key: "rmw-meshmap-cache-v1" },
  { scope: "localStorage", policy: "preserve", key: "rmw-meshmap-source-url-v1" },
  { scope: "localStorage", policy: "preserve", key: "linksim-copernicus-tilelist-v1" },
  { scope: "localStorage", policy: "preserve", key: "linksim-copernicus-tile-index-v1" },
  { scope: "localStorage", policy: "preserve", prefix: "linksim:onboarding-seen:v1:" },
  { scope: "localStorage", policy: "preserve", key: "linksim:mobile-warning-dismissed:v1" },
  { scope: "localStorage", policy: "preserve", key: "linksim:local-force-readonly:v1" },
  { scope: "localStorage", policy: "preserve", key: "rmw-storage-boot-v1" },
  { scope: "localStorage", policy: "resetOnVersionChange", key: "rmw-storage-health-v1" },
  { scope: "localStorage", policy: "preserve", key: "rmw-last-simulation-ref-v1" },
  { scope: "localStorage", policy: "preserve", key: "linksim-migration-default-private-v2" },
  { scope: "localStorage", policy: "preserve", key: STORED_VERSION_KEY },
  { scope: "cacheStorage", policy: "preserve", cacheName: "linksim-copernicus-cog-v1" },
  { scope: "memory", policy: "resetOnVersionChange", id: "terrain-loss-memo", clear: clearTerrainLossCache },
];

export type Migration = {
  id: string;
  fromVersion?: string;
  toVersion?: string;
  onVersionChange?: boolean;
  migrate: () => Promise<void>;
};

const migrations: Migration[] = [];

const removeLocalStorageByPrefix = (prefix: string): number => {
  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (typeof key === "string" && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
    return keysToRemove.length;
  } catch {
    return 0;
  }
};

export const applyClientStorageVersionPolicy = async (): Promise<{ localStorage: number; cacheStorage: number; memory: number }> => {
  let localStorageCleared = 0;
  let cacheStorageCleared = 0;
  let memoryCleared = 0;

  for (const rule of CLIENT_STORAGE_RULES) {
    if (rule.policy !== "resetOnVersionChange") continue;

    try {
      if (rule.scope === "localStorage") {
        if (rule.key) {
          localStorage.removeItem(rule.key);
          localStorageCleared += 1;
        }
        if (rule.prefix) {
          localStorageCleared += removeLocalStorageByPrefix(rule.prefix);
        }
        continue;
      }

      if (rule.scope === "cacheStorage") {
        if (typeof caches !== "undefined") {
          const removed = await caches.delete(rule.cacheName);
          if (removed) {
            cacheStorageCleared += 1;
          }
        }
        continue;
      }

      rule.clear();
      memoryCleared += 1;
    } catch (error) {
      const id = rule.scope === "memory" ? rule.id : rule.scope === "cacheStorage" ? rule.cacheName : (rule.key ?? rule.prefix ?? "localStorage");
      console.error(`[migrations] Failed storage policy clear for ${id}`, error);
    }
  }

  return { localStorage: localStorageCleared, cacheStorage: cacheStorageCleared, memory: memoryCleared };
};

export const clearMigrations = (): void => {
  migrations.length = 0;
};

export const registerMigration = (migration: Migration): void => {
  if (migrations.some((entry) => entry.id === migration.id)) return;
  migrations.push(migration);
};

export const initializeMigrations = (): void => {
  registerMigration({
    id: "apply-client-storage-version-policy-v1",
    onVersionChange: true,
    migrate: async () => {
      const result = await applyClientStorageVersionPolicy();
      console.log(
        `[migrations] Client storage policy applied (localStorage=${result.localStorage}, cacheStorage=${result.cacheStorage}, memory=${result.memory})`,
      );
    },
  });
};

export const getStoredVersion = (): string | null => {
  try {
    return localStorage.getItem(STORED_VERSION_KEY);
  } catch {
    return null;
  }
};

export const setStoredVersion = (version: string): void => {
  try {
    localStorage.setItem(STORED_VERSION_KEY, version);
  } catch {
    console.error(`[migrations] Failed to persist version ${version}`);
  }
};

export const runMigrations = async (): Promise<{ migrated: boolean; from: string | null; to: string }> => {
  const previousVersion = getStoredVersion();
  const currentVersion = APP_VERSION;

  if (previousVersion === currentVersion) {
    return { migrated: false, from: previousVersion, to: currentVersion };
  }

  console.log(`[migrations] Version changed: ${previousVersion ?? "(none)"} -> ${currentVersion}`);

  let anyMigrated = false;
  const relevantMigrations = migrations.filter((m) => {
    if (m.onVersionChange) {
      return true;
    }
    if (m.fromVersion) {
      return m.fromVersion === previousVersion;
    }
    return previousVersion === null;
  });

  for (const migration of relevantMigrations) {
    try {
      console.log(`[migrations] Running migration: ${migration.id}`);
      await migration.migrate();
      console.log(`[migrations] Migration complete: ${migration.id}`);
      anyMigrated = true;
    } catch (error) {
      console.error(`[migrations] Migration failed: ${migration.id}`, error);
    }
  }

  setStoredVersion(currentVersion);
  return { migrated: anyMigrated, from: previousVersion, to: currentVersion };
};
