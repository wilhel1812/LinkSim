import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  executeIdentityDelete,
  executeIdentityRestore,
  executeIdentityRoleChange,
  executeUnverifiedIdentityEnsure,
  executeVerifiedIdentityEnsure,
  fetchLibraryForUser,
  fetchMyUserProfile,
  revertResourceFromChangeCopy,
  setUserAvatarAssets,
  updateUserProfile,
} from "./db";

class SqliteStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly hooks: { beforeRun: ((sql: string) => Promise<void> | void) | null },
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.values as never[]) as T[] };
  }

  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.values as never[]) as T | undefined) ?? null;
  }

  async run() {
    await this.hooks.beforeRun?.(this.sql);
    this.runSync();
    return { success: true };
  }

  runSync() {
    try {
      this.db.prepare(this.sql).run(...this.values as never[]);
    } catch (error) {
      throw new Error(`${String(error)}\nSQL: ${this.sql}`);
    }
  }
}

class SqliteD1 {
  readonly db = new DatabaseSync(":memory:");
  beforeBatch: (() => void) | null = null;
  beforeRun: ((sql: string) => Promise<void> | void) | null = null;

  constructor() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT, email TEXT, username_set_at TEXT, bio TEXT, access_request_note TEXT,
        idp_email TEXT, idp_email_verified INTEGER NOT NULL DEFAULT 0, avatar_url TEXT, email_public INTEGER,
        default_frequency_preset_id TEXT, simulation_defaults_preference_json TEXT, basemap_preferences_json TEXT, avatar_object_key TEXT,
        avatar_thumb_key TEXT, avatar_hash TEXT, avatar_bytes INTEGER, avatar_content_type TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0, is_moderator INTEGER NOT NULL DEFAULT 0,
        is_approved INTEGER NOT NULL DEFAULT 0, approved_at TEXT, approved_by_user_id TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE deleted_users (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL, deleted_by_user_id TEXT);
      CREATE TABLE verified_identity_claims (
        normalized_email TEXT PRIMARY KEY, current_user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'blocked')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, blocked_at TEXT, blocked_by_user_id TEXT
      );
      CREATE TABLE identity_subject_states (
        user_id TEXT PRIMARY KEY, normalized_email TEXT,
        status TEXT NOT NULL CHECK (status IN ('current', 'superseded', 'blocked')),
        canonical_user_id TEXT, bootstrap_consumed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, changed_by_user_id TEXT
      );
      CREATE TABLE identity_lifecycle_meta (
        singleton INTEGER PRIMARY KEY, version TEXT NOT NULL, applied_at TEXT NOT NULL
      );
      INSERT INTO identity_lifecycle_meta VALUES
        (1, '2026-08-12-identity-lifecycle-v1', '2026-08-12T00:00:00.000Z');
      CREATE TABLE user_identity_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, target_user_id TEXT NOT NULL,
        source_user_id TEXT, actor_user_id TEXT, idp_email TEXT, details_json TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE sites (
        id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, created_by_user_id TEXT, last_edited_by_user_id TEXT,
        created_at TEXT, last_edited_at TEXT, name TEXT, visibility TEXT, payload_json TEXT, updated_at TEXT,
        FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE simulations (
        id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, created_by_user_id TEXT, last_edited_by_user_id TEXT,
        created_at TEXT, last_edited_at TEXT, name TEXT, visibility TEXT, status TEXT DEFAULT 'active', payload_json TEXT,
        updated_at TEXT, FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE site_roles (
        site_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (site_id, user_id), FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE simulation_roles (
        simulation_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (simulation_id, user_id), FOREIGN KEY (simulation_id) REFERENCES simulations(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE resource_changes (
        id INTEGER PRIMARY KEY, resource_kind TEXT, resource_id TEXT, action TEXT, actor_user_id TEXT NOT NULL,
        changed_at TEXT, note TEXT, details_json TEXT, snapshot_json TEXT
      );
      CREATE TABLE simulation_path_leaderboard_entries (
        simulation_id TEXT, canonical_path_key TEXT, owner_user_id TEXT NOT NULL, from_site_id TEXT, to_site_id TEXT,
        link_id TEXT, path_label TEXT, simulation_name TEXT, distance_km REAL, rx_after_env_loss_dbm REAL,
        rx_margin_db REAL, terrain_obstructed INTEGER, terrain_dataset TEXT, terrain_tile_signature TEXT,
        simulation_updated_at TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY (simulation_id, canonical_path_key)
      );
    `);
  }

  prepare(sql: string) {
    return new SqliteStatement(this.db, sql, this);
  }

  async batch(statements: SqliteStatement[]) {
    this.beforeBatch?.();
    this.beforeBatch = null;
    this.db.exec("BEGIN");
    try {
      for (const statement of statements) statement.runSync();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return statements.map(() => ({ success: true }));
  }
}

const envFor = (database: SqliteD1) => ({ DB: database as unknown as D1Database });

const ensure = (database: SqliteD1, userId: string, email = "user@example.com") =>
  executeVerifiedIdentityEnsure(envFor(database), {
    userId,
    email,
    defaultEmail: email,
    bootstrapAdmin: false,
    now: "2026-08-12T12:00:00.000Z",
  });

const seedCanonicalAccount = (database: SqliteD1) => {
  database.db.exec(`
    INSERT INTO users
      (id, username, email, username_set_at, bio, access_request_note, idp_email, idp_email_verified,
       avatar_url, email_public, default_frequency_preset_id, simulation_defaults_preference_json, basemap_preferences_json,
       avatar_object_key, avatar_thumb_key, avatar_hash, avatar_bytes, avatar_content_type,
       is_admin, is_approved, approved_at, approved_by_user_id, created_at, updated_at)
      VALUES (
        'old-subject', 'Chosen Operator', 'profile@example.net', '2026-01-02', 'Profile bio', 'Access note',
        'user@example.com', 1, '/api/avatar/users/opaque/avatar.webp', 0, 'preset-1', '{"frequencyMHz":146.52}', '{"version":1,"customSources":[{"id":"field","name":"Field map","kind":"style","lightUrl":"https://maps.test/style.json","attribution":"Field data"}]}',
        'users/opaque/avatar.webp', 'users/opaque/avatar-thumb.webp', 'avatar-hash', 1234, 'image/webp',
        1, 1, '2026-01-01', 'old-subject', '2025-12-15', '2026-01-03'
      );
    INSERT INTO verified_identity_claims VALUES
      ('user@example.com', 'old-subject', 'active', '2026-01-01', '2026-01-01', NULL, NULL),
      ('alias@example.com', 'old-subject', 'active', '2026-01-01', '2026-01-01', NULL, NULL);
    INSERT INTO identity_subject_states VALUES
      ('old-subject', 'user@example.com', 'current', 'old-subject', 1, '2026-01-01', '2026-01-01', NULL);
    INSERT INTO sites VALUES (
      'site-1', 'old-subject', 'old-subject', 'old-subject', '2026-01-01', '2026-01-01', 'Site', 'public_write',
      '{"id":"site-1","name":"Site","visibility":"shared","ownerUserId":"old-subject","createdByUserId":"old-subject","lastEditedByUserId":"old-subject","sharedWith":[{"userId":"old-subject","role":"editor"}]}',
      '2026-01-01'
    );
    INSERT INTO simulations VALUES (
      'sim-1', 'old-subject', 'old-subject', 'old-subject', '2026-01-01', '2026-01-01', 'Simulation', 'public_write', 'active',
      '{"id":"sim-1","name":"Simulation","visibility":"shared","ownerUserId":"old-subject","createdByUserId":"old-subject","lastEditedByUserId":"old-subject","sharedWith":[{"userId":"old-subject","role":"viewer"}]}',
      '2026-01-01'
    );
    INSERT INTO site_roles VALUES ('site-1', 'old-subject', 'editor', '2026-01-01');
    INSERT INTO simulation_roles VALUES ('sim-1', 'old-subject', 'viewer', '2026-01-01');
    INSERT INTO resource_changes VALUES (
      1, 'site', 'site-1', 'updated', 'old-subject', '2026-01-01', NULL, NULL,
      '{"id":"site-1","name":"Historical Site","visibility":"shared","ownerUserId":"old-subject","createdByUserId":"old-subject","lastEditedByUserId":"old-subject","sharedWith":[{"userId":"old-subject","role":"admin"}]}'
    );
    INSERT INTO simulation_path_leaderboard_entries
      (simulation_id, canonical_path_key, owner_user_id) VALUES ('sim-1', 'path-1', 'old-subject');
  `);
};

describe("authoritative identity lifecycle", () => {
  it("does not overwrite concurrent basemap and radio-default profile patches", async () => {
    const basemapLast = new SqliteD1();
    seedCanonicalAccount(basemapLast);
    await fetchMyUserProfile(envFor(basemapLast) as never, "old-subject");
    basemapLast.beforeRun = (sql) => {
      if (!/^\s*UPDATE users\s+SET/.test(sql)) return;
      basemapLast.beforeRun = null;
      basemapLast.db.prepare(
        "UPDATE users SET default_frequency_preset_id = 'meshcore-us-narrow-910525-sf7-bw625-cr5' WHERE id = 'old-subject'",
      ).run();
    };
    await updateUserProfile(envFor(basemapLast) as never, "old-subject", {
      basemapPreferences: {
        version: 1,
        customSources: [{ id: "new-map", name: "New map", kind: "style", lightUrl: "https://maps.test/new.json", attribution: "New data" }],
      },
    }, { includeBasemapPreferences: true });
    const basemapLastRow = basemapLast.db.prepare(
      "SELECT default_frequency_preset_id, basemap_preferences_json FROM users WHERE id = 'old-subject'",
    ).get() as { default_frequency_preset_id: string; basemap_preferences_json: string };
    expect(basemapLastRow.default_frequency_preset_id).toBe("meshcore-us-narrow-910525-sf7-bw625-cr5");
    expect(JSON.parse(basemapLastRow.basemap_preferences_json).customSources[0].id).toBe("new-map");

    const radioLast = new SqliteD1();
    seedCanonicalAccount(radioLast);
    await fetchMyUserProfile(envFor(radioLast) as never, "old-subject");
    const concurrentBasemap = JSON.stringify({
      version: 1,
      customSources: [{ id: "new-map", name: "New map", kind: "style", lightUrl: "https://maps.test/new.json", attribution: "New data" }],
    });
    radioLast.beforeRun = (sql) => {
      if (!/^\s*UPDATE users\s+SET/.test(sql)) return;
      radioLast.beforeRun = null;
      radioLast.db.prepare("UPDATE users SET basemap_preferences_json = ? WHERE id = 'old-subject'").run(concurrentBasemap);
    };
    await updateUserProfile(envFor(radioLast) as never, "old-subject", {
      defaultFrequencyPresetId: "meshcore-us-narrow-910525-sf7-bw625-cr5",
    }, { includeBasemapPreferences: true });
    const radioLastRow = radioLast.db.prepare(
      "SELECT default_frequency_preset_id, basemap_preferences_json FROM users WHERE id = 'old-subject'",
    ).get() as { default_frequency_preset_id: string; basemap_preferences_json: string };
    expect(radioLastRow.default_frequency_preset_id).toBe("meshcore-us-narrow-910525-sf7-bw625-cr5");
    expect(JSON.parse(radioLastRow.basemap_preferences_json).customSources[0].id).toBe("new-map");
  });

  it("returns private basemap preferences after the current user updates an avatar", async () => {
    const database = new SqliteD1();
    seedCanonicalAccount(database);

    const profile = await setUserAvatarAssets(envFor(database) as never, "old-subject", {
      avatarUrl: "/api/avatar/users/new/avatar.webp",
      avatarObjectKey: "users/new/avatar.webp",
      avatarThumbKey: "users/new/avatar-thumb.webp",
      avatarHash: "new-avatar-hash",
      avatarBytes: 4321,
      avatarContentType: "image/webp",
    });

    expect(profile.basemapPreferences?.customSources).toEqual([
      expect.objectContaining({ id: "field", lightUrl: "https://maps.test/style.json" }),
    ]);
  });

  it("atomically migrates every identity alias and observable resource timestamp", async () => {
    const database = new SqliteD1();
    seedCanonicalAccount(database);

    await ensure(database, "new-subject");

    expect(database.db.prepare("SELECT id, is_admin FROM users").all()).toEqual([
      { id: "new-subject", is_admin: 1 },
    ]);
    expect(database.db.prepare(`
      SELECT username, email, username_set_at, bio, access_request_note, avatar_url, email_public,
             default_frequency_preset_id, simulation_defaults_preference_json, basemap_preferences_json, avatar_object_key,
             avatar_thumb_key, avatar_hash, avatar_bytes, avatar_content_type, created_at
      FROM users WHERE id = 'new-subject'
    `).get()).toEqual({
      username: "Chosen Operator",
      email: "profile@example.net",
      username_set_at: "2026-01-02",
      bio: "Profile bio",
      access_request_note: "Access note",
      avatar_url: "/api/avatar/users/opaque/avatar.webp",
      email_public: 0,
      default_frequency_preset_id: "preset-1",
      simulation_defaults_preference_json: '{"frequencyMHz":146.52}',
      basemap_preferences_json: '{"version":1,"customSources":[{"id":"field","name":"Field map","kind":"style","lightUrl":"https://maps.test/style.json","attribution":"Field data"}]}',
      avatar_object_key: "users/opaque/avatar.webp",
      avatar_thumb_key: "users/opaque/avatar-thumb.webp",
      avatar_hash: "avatar-hash",
      avatar_bytes: 1234,
      avatar_content_type: "image/webp",
      created_at: "2025-12-15",
    });
    expect(database.db.prepare("SELECT normalized_email, current_user_id FROM verified_identity_claims ORDER BY normalized_email").all()).toEqual([
      { normalized_email: "alias@example.com", current_user_id: "new-subject" },
      { normalized_email: "user@example.com", current_user_id: "new-subject" },
    ]);
    expect(database.db.prepare("SELECT status, canonical_user_id FROM identity_subject_states WHERE user_id = 'old-subject'").get()).toEqual({
      status: "superseded",
      canonical_user_id: "new-subject",
    });
    expect(database.db.prepare("SELECT owner_user_id, updated_at FROM sites").get()).toEqual({
      owner_user_id: "new-subject",
      updated_at: "2026-08-12T12:00:00.000Z",
    });
    expect(database.db.prepare("SELECT owner_user_id, updated_at FROM simulations").get()).toEqual({
      owner_user_id: "new-subject",
      updated_at: "2026-08-12T12:00:00.000Z",
    });
    for (const row of database.db.prepare("SELECT payload_json FROM sites UNION ALL SELECT payload_json FROM simulations").all() as Array<{ payload_json: string }>) {
      expect(JSON.parse(row.payload_json)).toMatchObject({
        ownerUserId: "new-subject",
        createdByUserId: "new-subject",
        lastEditedByUserId: "new-subject",
      });
      expect(row.payload_json).not.toContain("old-subject");
    }
    const migratedSnapshot = JSON.parse((database.db.prepare("SELECT snapshot_json FROM resource_changes").get() as { snapshot_json: string }).snapshot_json);
    expect(migratedSnapshot.sharedWith).toEqual([
      { userId: "new-subject", role: "admin" },
    ]);
    expect(migratedSnapshot).toMatchObject({
      ownerUserId: "new-subject",
      createdByUserId: "new-subject",
      lastEditedByUserId: "new-subject",
    });

    const delta = await fetchLibraryForUser(envFor(database) as Parameters<typeof fetchLibraryForUser>[0], "new-subject", {
      since: "2026-08-12T11:59:59.000Z",
    });
    expect(delta.siteLibrary.map((item) => item.id)).toEqual(["site-1"]);
    expect(delta.simulationPresets.map((item) => item.id)).toEqual(["sim-1"]);

    await expect(revertResourceFromChangeCopy(
      envFor(database) as Parameters<typeof revertResourceFromChangeCopy>[0],
      "site",
      "site-1",
      1,
      { id: "new-subject", isAdmin: true, isModerator: false },
    )).resolves.toEqual({ ok: true });
    expect(database.db.prepare("SELECT user_id, role FROM site_roles WHERE site_id = 'site-1'").all()).toEqual([]);
    const reverted = JSON.parse((database.db.prepare("SELECT payload_json FROM sites WHERE id = 'site-1'").get() as { payload_json: string }).payload_json);
    expect(reverted.name).toBe("Historical Site");
    expect(JSON.stringify(reverted)).not.toContain("old-subject");
  });

  it("does not delete the current user when the same subject presents a new verified alias", async () => {
    const database = new SqliteD1();
    seedCanonicalAccount(database);

    await ensure(database, "old-subject", "new-alias@example.com");

    expect(database.db.prepare("SELECT id FROM users").all()).toEqual([{ id: "old-subject" }]);
    expect(database.db.prepare("SELECT role FROM site_roles").get()).toEqual({ role: "editor" });
    expect(database.db.prepare("SELECT current_user_id FROM verified_identity_claims WHERE normalized_email = 'new-alias@example.com'").get()).toEqual({ current_user_id: "old-subject" });
  });

  it("keeps a fresh verified signup username empty and unset", async () => {
    const database = new SqliteD1();

    await ensure(database, "fresh-subject", "fresh@example.com");

    expect(database.db.prepare("SELECT username, username_set_at FROM users WHERE id = 'fresh-subject'").get()).toEqual({
      username: "",
      username_set_at: null,
    });
  });

  it("preserves mandatory username setup when an incomplete account rotates subject", async () => {
    const database = new SqliteD1();
    seedCanonicalAccount(database);
    database.db.exec("UPDATE users SET username = '', username_set_at = NULL WHERE id = 'old-subject'");

    await ensure(database, "new-subject");

    expect(database.db.prepare("SELECT username, username_set_at FROM users WHERE id = 'new-subject'").get()).toEqual({
      username: "",
      username_set_at: null,
    });
  });

  it("does not retain privileges from a preexisting replacement-subject account", async () => {
    const database = new SqliteD1();
    seedCanonicalAccount(database);
    database.db.exec(`
      UPDATE users
      SET is_admin = 0, is_moderator = 0, is_approved = 1,
          approved_at = '2026-01-04', approved_by_user_id = 'source-approver'
      WHERE id = 'old-subject';
    `);
    await executeUnverifiedIdentityEnsure(envFor(database), {
      userId: "new-subject",
      defaultEmail: "target-header@example.com",
      bootstrapAdmin: true,
      now: "2026-08-12T11:59:00.000Z",
    });
    database.db.exec(`
      UPDATE users
      SET username = 'Target Administrator', username_set_at = '2026-08-01', is_moderator = 1
      WHERE id = 'new-subject';
    `);

    await ensure(database, "new-subject");

    expect(database.db.prepare(`
      SELECT username, is_admin, is_moderator, is_approved, approved_at, approved_by_user_id,
             idp_email, idp_email_verified
      FROM users WHERE id = 'new-subject'
    `).get()).toEqual({
      username: "Chosen Operator",
      is_admin: 0,
      is_moderator: 0,
      is_approved: 1,
      approved_at: "2026-01-04",
      approved_by_user_id: "source-approver",
      idp_email: "user@example.com",
      idp_email_verified: 1,
    });
  });

  it("rolls back subject rotation when it would create duplicate active simulation names", async () => {
    const database = new SqliteD1();
    seedCanonicalAccount(database);
    await executeUnverifiedIdentityEnsure(envFor(database), {
      userId: "new-subject",
      defaultEmail: "target-header@example.com",
      bootstrapAdmin: false,
      now: "2026-08-12T11:59:00.000Z",
    });
    database.db.exec(`
      INSERT INTO simulations (
        id, owner_user_id, created_by_user_id, last_edited_by_user_id, created_at, last_edited_at,
        name, visibility, status, payload_json, updated_at
      ) VALUES (
        'sim-target', 'new-subject', 'new-subject', 'new-subject', '2026-08-01', '2026-08-01',
        'simulation', 'private', 'active', '{"id":"sim-target","name":"simulation"}', '2026-08-01'
      );
    `);

    await expect(ensure(database, "new-subject")).rejects.toThrow(/UNIQUE constraint failed/);

    expect(database.db.prepare("SELECT current_user_id FROM verified_identity_claims WHERE normalized_email = 'user@example.com'").get()).toEqual({
      current_user_id: "old-subject",
    });
    expect(database.db.prepare("SELECT id FROM users ORDER BY id").all()).toEqual([
      { id: "new-subject" },
      { id: "old-subject" },
    ]);
    expect(database.db.prepare("SELECT id, owner_user_id FROM simulations ORDER BY id").all()).toEqual([
      { id: "sim-1", owner_user_id: "old-subject" },
      { id: "sim-target", owner_user_id: "new-subject" },
    ]);
  });

  it("permanently rejects a superseded subject instead of moving the account back", async () => {
    const database = new SqliteD1();
    seedCanonicalAccount(database);
    await ensure(database, "new-subject");

    await expect(ensure(database, "old-subject")).rejects.toThrow("Identity subject is no longer current");
    expect(database.db.prepare("SELECT current_user_id FROM verified_identity_claims WHERE normalized_email = 'user@example.com'").get()).toEqual({ current_user_id: "new-subject" });

    await expect(executeUnverifiedIdentityEnsure(envFor(database), {
      userId: "old-subject",
      defaultEmail: "old-subject@users.linksim.local",
      bootstrapAdmin: false,
      now: "2026-08-12T12:00:01.000Z",
    })).rejects.toThrow("Identity subject is no longer current");
    expect(database.db.prepare("SELECT id FROM users WHERE id = 'old-subject'").get()).toBeUndefined();
  });

  it("rolls back the complete command when its audit insert fails, then retries cleanly", async () => {
    const database = new SqliteD1();
    seedCanonicalAccount(database);
    database.db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON user_identity_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");

    await expect(ensure(database, "new-subject")).rejects.toThrow("audit unavailable");
    expect(database.db.prepare("SELECT current_user_id FROM verified_identity_claims WHERE normalized_email = 'user@example.com'").get()).toEqual({ current_user_id: "old-subject" });
    expect(database.db.prepare("SELECT id FROM users").all()).toEqual([{ id: "old-subject" }]);

    database.db.exec("DROP TRIGGER reject_audit");
    await ensure(database, "new-subject");
    expect(database.db.prepare("SELECT id FROM users").all()).toEqual([{ id: "new-subject" }]);
  });

  it("resolves a stale administrator revoke through the superseded subject", async () => {
    const database = new SqliteD1();
    seedCanonicalAccount(database);
    await ensure(database, "new-subject");

    await executeIdentityRoleChange(envFor(database), "old-subject", "pending", "admin-id", "2026-08-12T12:01:00.000Z");

    expect(database.db.prepare("SELECT is_admin, is_approved, approved_by_user_id FROM users WHERE id = 'new-subject'").get()).toEqual({
      is_admin: 0,
      is_approved: 0,
      approved_by_user_id: "revoked:admin-id",
    });
  });

  it("carries a revoke that commits before subject migration", async () => {
    const database = new SqliteD1();
    seedCanonicalAccount(database);

    await executeIdentityRoleChange(envFor(database), "old-subject", "pending", "admin-id", "2026-08-12T11:59:00.000Z");
    await ensure(database, "new-subject");

    expect(database.db.prepare("SELECT is_admin, is_approved, approved_by_user_id FROM users WHERE id = 'new-subject'").get()).toEqual({
      is_admin: 0,
      is_approved: 0,
      approved_by_user_id: "revoked:admin-id",
    });
  });

  it("flattens repeated subject rotations so the oldest administrator target resolves current", async () => {
    const database = new SqliteD1();
    seedCanonicalAccount(database);
    await ensure(database, "middle-subject");
    await ensure(database, "newest-subject");

    expect(database.db.prepare("SELECT canonical_user_id FROM identity_subject_states WHERE user_id = 'old-subject'").get()).toEqual({
      canonical_user_id: "newest-subject",
    });
    await executeIdentityRoleChange(envFor(database), "old-subject", "pending", "admin-id", "2026-08-12T12:01:00.000Z");
    expect(database.db.prepare("SELECT is_approved, approved_by_user_id FROM users WHERE id = 'newest-subject'").get()).toEqual({
      is_approved: 0,
      approved_by_user_id: "revoked:admin-id",
    });
  });

  it("makes deletion durable across aliases and subject changes until explicit restore", async () => {
    const database = new SqliteD1();
    seedCanonicalAccount(database);
    await ensure(database, "new-subject");

    await executeIdentityDelete(envFor(database), "old-subject", "admin-id", "2026-08-12T12:02:00.000Z");
    await expect(ensure(database, "third-subject", "alias@example.com")).rejects.toThrow("Identity is blocked by an administrator");
    expect(database.db.prepare("SELECT status FROM verified_identity_claims ORDER BY normalized_email").all()).toEqual([
      { status: "blocked" },
      { status: "blocked" },
    ]);

    await executeIdentityRestore(envFor(database), "new-subject", "admin-id", "2026-08-12T12:03:00.000Z");
    await ensure(database, "third-subject", "alias@example.com");
    expect(database.db.prepare("SELECT id FROM users").all()).toEqual([{ id: "third-subject" }]);
  });

  it("serializes a delete that lands immediately before ensure", async () => {
    const database = new SqliteD1();
    seedCanonicalAccount(database);
    database.beforeBatch = () => {
      database.db.exec(`
        UPDATE verified_identity_claims SET status = 'blocked', blocked_at = '2026-08-12T11:59:00.000Z';
        UPDATE identity_subject_states SET status = 'blocked' WHERE user_id = 'old-subject';
        INSERT INTO deleted_users VALUES ('old-subject', '2026-08-12T11:59:00.000Z', 'admin-id');
        DELETE FROM users WHERE id = 'old-subject';
      `);
    };

    await expect(ensure(database, "new-subject")).rejects.toThrow("Identity is blocked by an administrator");
    expect(database.db.prepare("SELECT id FROM users").all()).toEqual([]);
  });

  it("creates restorable canonical subject state when deleting an account without a verified claim", async () => {
    const database = new SqliteD1();
    database.db.exec(`
      INSERT INTO users (id, email, idp_email_verified, is_approved, created_at, updated_at)
      VALUES ('header-subject', 'header@example.com', 0, 1, '2026-01-01', '2026-01-01');
    `);

    await executeIdentityDelete(envFor(database), "header-subject", "admin-id", "2026-08-12T12:04:00.000Z");
    expect(database.db.prepare("SELECT status, canonical_user_id FROM identity_subject_states WHERE user_id = 'header-subject'").get()).toEqual({
      status: "blocked",
      canonical_user_id: "header-subject",
    });

    await executeIdentityRestore(envFor(database), "header-subject", "admin-id", "2026-08-12T12:05:00.000Z");
    expect(database.db.prepare("SELECT status FROM identity_subject_states WHERE user_id = 'header-subject'").get()).toEqual({ status: "current" });
  });

  it("does not reapply bootstrap admin after demotion, deletion, restore, and reauthentication", async () => {
    const database = new SqliteD1();
    const input = {
      userId: "bootstrap-subject",
      defaultEmail: "bootstrap@example.com",
      bootstrapAdmin: true,
      now: "2026-08-12T12:06:00.000Z",
    };
    await executeUnverifiedIdentityEnsure(envFor(database), input);
    expect(database.db.prepare("SELECT is_admin FROM users WHERE id = 'bootstrap-subject'").get()).toEqual({ is_admin: 1 });

    await executeIdentityRoleChange(envFor(database), "bootstrap-subject", "user", "admin-id", "2026-08-12T12:07:00.000Z");
    await executeIdentityDelete(envFor(database), "bootstrap-subject", "admin-id", "2026-08-12T12:08:00.000Z");
    await executeIdentityRestore(envFor(database), "bootstrap-subject", "admin-id", "2026-08-12T12:09:00.000Z");
    await executeUnverifiedIdentityEnsure(envFor(database), { ...input, now: "2026-08-12T12:10:00.000Z" });

    expect(database.db.prepare("SELECT is_admin, is_approved FROM users WHERE id = 'bootstrap-subject'").get()).toEqual({
      is_admin: 0,
      is_approved: 1,
    });
    expect(database.db.prepare("SELECT bootstrap_consumed FROM identity_subject_states WHERE user_id = 'bootstrap-subject'").get()).toEqual({
      bootstrap_consumed: 1,
    });
  });

  it("does not treat a new subject as a fresh bootstrap when the verified account already exists", async () => {
    const database = new SqliteD1();
    database.db.exec(`
      INSERT INTO users
        (id, email, idp_email, idp_email_verified, is_admin, is_approved, approved_at, approved_by_user_id, created_at, updated_at)
      VALUES ('existing-subject', 'user@example.com', 'user@example.com', 1, 0, 1, '2026-01-01', 'admin-id', '2026-01-01', '2026-01-01');
      INSERT INTO verified_identity_claims VALUES
        ('user@example.com', 'existing-subject', 'active', '2026-01-01', '2026-01-01', NULL, NULL);
      INSERT INTO identity_subject_states VALUES
        ('existing-subject', 'user@example.com', 'current', 'existing-subject', 1, '2026-01-01', '2026-01-01', NULL);
    `);

    await executeVerifiedIdentityEnsure(envFor(database), {
      userId: "listed-new-subject",
      email: "user@example.com",
      defaultEmail: "user@example.com",
      bootstrapAdmin: true,
      now: "2026-08-12T12:11:00.000Z",
    });

    expect(database.db.prepare("SELECT is_admin, is_approved FROM users WHERE id = 'listed-new-subject'").get()).toEqual({
      is_admin: 0,
      is_approved: 1,
    });
  });
});
