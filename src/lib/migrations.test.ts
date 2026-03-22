import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => {
  const data = new Map<string, string>();
  const mock = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
  vi.stubGlobal("localStorage", mock);
  return { data, mock };
});

vi.mock("../lib/buildInfo", () => ({
  APP_VERSION: "1.0.0",
}));

describe("migrations", () => {
  beforeEach(async () => {
    storage.mock.clear();
    const { clearMigrations } = await import("./migrations");
    clearMigrations();
  });

  it("returns no migration when previous version matches current", async () => {
    const { setStoredVersion, runMigrations } = await import("./migrations");

    setStoredVersion("1.0.0");
    const result = await runMigrations();

    expect(result.migrated).toBe(false);
    expect(result.from).toBe("1.0.0");
    expect(result.to).toBe("1.0.0");
  });

  it("runs migrations and updates version when version changes", async () => {
    const { getStoredVersion, setStoredVersion, registerMigration, runMigrations } = await import("./migrations");

    setStoredVersion("0.9.0");
    const migrateFn = vi.fn().mockResolvedValue(undefined);
    registerMigration({
      id: "test-migration",
      fromVersion: "0.9.0",
      toVersion: "1.0.0",
      migrate: migrateFn,
    });

    const result = await runMigrations();

    expect(result.migrated).toBe(true);
    expect(result.from).toBe("0.9.0");
    expect(result.to).toBe("1.0.0");
    expect(migrateFn).toHaveBeenCalledTimes(1);
    expect(getStoredVersion()).toBe("1.0.0");
  });

  it("runs migrations for first launch when no version stored", async () => {
    const { getStoredVersion, registerMigration, runMigrations } = await import("./migrations");

    const migrateFn = vi.fn().mockResolvedValue(undefined);
    registerMigration({
      id: "first-launch-migration",
      toVersion: "1.0.0",
      migrate: migrateFn,
    });

    const result = await runMigrations();

    expect(result.migrated).toBe(true);
    expect(result.from).toBe(null);
    expect(result.to).toBe("1.0.0");
    expect(migrateFn).toHaveBeenCalledTimes(1);
    expect(getStoredVersion()).toBe("1.0.0");
  });

  it("does not run migrations on first launch when no migrations registered", async () => {
    const { runMigrations } = await import("./migrations");

    const result = await runMigrations();

    expect(result.migrated).toBe(false);
    expect(result.from).toBe(null);
  });

  it("continues running remaining migrations even if one fails", async () => {
    const { setStoredVersion, registerMigration, runMigrations } = await import("./migrations");

    setStoredVersion("0.8.0");
    const firstMigrate = vi.fn().mockRejectedValue(new Error("fail"));
    const secondMigrate = vi.fn().mockResolvedValue(undefined);

    registerMigration({
      id: "failing-migration",
      fromVersion: "0.8.0",
      toVersion: "1.0.0",
      migrate: firstMigrate,
    });
    registerMigration({
      id: "passing-migration",
      fromVersion: "0.8.0",
      toVersion: "1.0.0",
      migrate: secondMigrate,
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await runMigrations();

    expect(result.migrated).toBe(true);
    expect(firstMigrate).toHaveBeenCalledTimes(1);
    expect(secondMigrate).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[migrations] Migration failed: failing-migration",
      expect.any(Error),
    );
    consoleErrorSpy.mockRestore();
  });

  it("skips migration with fromVersion that does not match previous", async () => {
    const { setStoredVersion, registerMigration, runMigrations } = await import("./migrations");

    setStoredVersion("0.8.0");
    const migrateFn = vi.fn().mockResolvedValue(undefined);
    registerMigration({
      id: "wrong-from-migration",
      fromVersion: "0.9.0",
      toVersion: "1.0.0",
      migrate: migrateFn,
    });

    await runMigrations();

    expect(migrateFn).not.toHaveBeenCalled();
  });

  it("skips migration when no version stored and migration has fromVersion", async () => {
    const { registerMigration, runMigrations } = await import("./migrations");

    const migrateFn = vi.fn().mockResolvedValue(undefined);
    registerMigration({
      id: "from-version-migration",
      fromVersion: "0.9.0",
      toVersion: "1.0.0",
      migrate: migrateFn,
    });

    await runMigrations();

    expect(migrateFn).not.toHaveBeenCalled();
  });

  it("runs onVersionChange migrations on any version change", async () => {
    const { setStoredVersion, registerMigration, runMigrations } = await import("./migrations");

    setStoredVersion("0.8.0");
    const migrateFn = vi.fn().mockResolvedValue(undefined);
    registerMigration({
      id: "version-change-migration",
      onVersionChange: true,
      migrate: migrateFn,
    });

    const result = await runMigrations();

    expect(result.migrated).toBe(true);
    expect(migrateFn).toHaveBeenCalledTimes(1);
  });

  it("runs onVersionChange migrations on first launch", async () => {
    const { registerMigration, runMigrations } = await import("./migrations");

    const migrateFn = vi.fn().mockResolvedValue(undefined);
    registerMigration({
      id: "version-change-migration",
      onVersionChange: true,
      migrate: migrateFn,
    });

    const result = await runMigrations();

    expect(result.migrated).toBe(true);
    expect(migrateFn).toHaveBeenCalledTimes(1);
  });
});
