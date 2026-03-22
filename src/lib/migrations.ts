import { APP_VERSION } from "./buildInfo";
import { clearCopernicusCache } from "./copernicusTerrainClient";
import { clearTerrainLossCache } from "./coverage";

const STORED_VERSION_KEY = "linksim-last-seen-version-v1";

export type Migration = {
  id: string;
  fromVersion?: string;
  toVersion?: string;
  onVersionChange?: boolean;
  migrate: () => Promise<void>;
};

const migrations: Migration[] = [];

export const clearMigrations = (): void => {
  migrations.length = 0;
};

export const registerMigration = (migration: Migration): void => {
  migrations.push(migration);
};

export const initializeMigrations = (): void => {
  registerMigration({
    id: "clear-terrain-cache-on-version-change",
    onVersionChange: true,
    migrate: async () => {
      await clearCopernicusCache();
      clearTerrainLossCache();
      console.log("[migrations] Terrain caches cleared for version change");
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
