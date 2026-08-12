import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  assertDeletedUserMayRegister,
  ensureUser,
  findDeletionBlock,
  reconcileUserIdentityByIdpEmail,
  revertResourceFromChangeCopy,
  shouldBootstrapAdmin,
  upsertLibrarySnapshot,
} from "./db";

class SqliteStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
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
    this.runSync();
    return { success: true };
  }

  runSync() {
    this.db.prepare(this.sql).run(...this.values as never[]);
  }
}

class SqliteD1 {
  readonly db = new DatabaseSync(":memory:");
  beforeBatch: (() => void) | null = null;

  constructor() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT, email TEXT, username_set_at TEXT, bio TEXT, access_request_note TEXT,
        idp_email TEXT, idp_email_verified INTEGER NOT NULL DEFAULT 0, avatar_url TEXT, email_public INTEGER,
        default_frequency_preset_id TEXT, simulation_defaults_preference_json TEXT, avatar_object_key TEXT,
        avatar_thumb_key TEXT, avatar_hash TEXT, avatar_bytes INTEGER, avatar_content_type TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0, is_moderator INTEGER NOT NULL DEFAULT 0,
        is_approved INTEGER NOT NULL DEFAULT 0, approved_at TEXT, approved_by_user_id TEXT, created_at TEXT, updated_at TEXT
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
      CREATE TABLE user_identity_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, target_user_id TEXT NOT NULL,
        source_user_id TEXT, actor_user_id TEXT, idp_email TEXT, details_json TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE deleted_users (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL, deleted_by_user_id TEXT);
    `);
  }

  prepare(sql: string) {
    return new SqliteStatement(this.db, sql);
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

const seedMigration = (db: SqliteD1) => {
  db.db.exec(`
    INSERT INTO users (id, email, idp_email, idp_email_verified, is_admin, is_approved, approved_at, approved_by_user_id)
      VALUES ('stable-id', 'new@example.com', 'user@example.com', 1, 0, 1, '2026-01-02', 'stable-id');
    INSERT INTO users (id, email, idp_email, idp_email_verified, is_admin, is_approved, approved_at, approved_by_user_id)
      VALUES ('legacy-id', 'editable@example.com', 'user@example.com', 1, 1, 1, '2026-01-01', 'legacy-id');
    INSERT INTO sites (id, owner_user_id, created_by_user_id, last_edited_by_user_id)
      VALUES ('site-1', 'legacy-id', 'legacy-id', 'legacy-id');
    INSERT INTO simulations (id, owner_user_id, created_by_user_id, last_edited_by_user_id)
      VALUES ('sim-1', 'legacy-id', 'legacy-id', 'legacy-id');
    INSERT INTO site_roles VALUES ('site-1', 'stable-id', 'viewer', '2026-01-02');
    INSERT INTO site_roles VALUES ('site-1', 'legacy-id', 'editor', '2026-01-01');
    INSERT INTO simulation_roles VALUES ('sim-1', 'stable-id', 'editor', '2026-01-02');
    INSERT INTO simulation_roles VALUES ('sim-1', 'legacy-id', 'viewer', '2026-01-01');
    INSERT INTO resource_changes (id, actor_user_id) VALUES (1, 'legacy-id');
    INSERT INTO simulation_path_leaderboard_entries (simulation_id, canonical_path_key, owner_user_id)
      VALUES ('sim-1', 'path-1', 'legacy-id');
  `);
};

describe("identity reconciliation", () => {
  it("transfers verified identity, strongest grants, ownership, and audit identity atomically", async () => {
    const db = new SqliteD1();
    seedMigration(db);

    await reconcileUserIdentityByIdpEmail({ DB: db as unknown as D1Database }, "stable-id", "user@example.com");

    expect(db.db.prepare("SELECT is_admin FROM users WHERE id = 'stable-id'").get()).toEqual({ is_admin: 1 });
    expect(db.db.prepare("SELECT id FROM users WHERE id = 'legacy-id'").get()).toBeUndefined();
    expect(db.db.prepare("SELECT owner_user_id FROM sites WHERE id = 'site-1'").get()).toEqual({ owner_user_id: "stable-id" });
    expect(db.db.prepare("SELECT role FROM site_roles WHERE site_id = 'site-1'").get()).toEqual({ role: "editor" });
    expect(db.db.prepare("SELECT role FROM simulation_roles WHERE simulation_id = 'sim-1'").get()).toEqual({ role: "editor" });
    expect(db.db.prepare("SELECT actor_user_id FROM resource_changes WHERE id = 1").get()).toEqual({ actor_user_id: "stable-id" });
    expect(db.db.prepare("SELECT event_type, source_user_id FROM user_identity_audit").get()).toEqual({
      event_type: "reconciled_by_verified_idp_email",
      source_user_id: "legacy-id",
    });
  });

  it("keeps serialized grants valid when a resource is saved after reconciliation", async () => {
    const db = new SqliteD1();
    db.db.exec(`
      INSERT INTO users (id, idp_email, idp_email_verified, is_approved)
        VALUES ('stable-id', 'user@example.com', 1, 1);
      INSERT INTO users (id, idp_email, idp_email_verified, is_approved)
        VALUES ('legacy-id', 'user@example.com', 1, 1);
      INSERT INTO users (id, idp_email, idp_email_verified, is_approved)
        VALUES ('owner-id', 'owner@example.com', 1, 1);
      INSERT INTO sites
        (id, owner_user_id, created_by_user_id, last_edited_by_user_id, created_at, name, visibility, payload_json, updated_at)
        VALUES (
          'shared-site', 'owner-id', 'owner-id', 'owner-id', '2026-01-01', 'Shared Site', 'public_write',
          '{"id":"shared-site","name":"Shared Site","visibility":"shared","sharedWith":[{"userId":"stable-id","role":"viewer"},{"userId":"legacy-id","role":"editor"}]}',
          '2026-01-01'
        );
      INSERT INTO simulations
        (id, owner_user_id, created_by_user_id, last_edited_by_user_id, created_at, name, visibility, status, payload_json, updated_at)
        VALUES (
          'shared-simulation', 'owner-id', 'owner-id', 'owner-id', '2026-01-01', 'Shared Simulation', 'public_write', 'active',
          '{"id":"shared-simulation","name":"Shared Simulation","visibility":"shared","sharedWith":[{"userId":"stable-id","role":"editor"},{"userId":"legacy-id","role":"viewer"}]}',
          '2026-01-01'
        );
      INSERT INTO site_roles VALUES ('shared-site', 'legacy-id', 'editor', '2026-01-01');
      INSERT INTO site_roles VALUES ('shared-site', 'stable-id', 'viewer', '2026-01-02');
      INSERT INTO simulation_roles VALUES ('shared-simulation', 'legacy-id', 'viewer', '2026-01-01');
      INSERT INTO simulation_roles VALUES ('shared-simulation', 'stable-id', 'editor', '2026-01-02');
      INSERT INTO resource_changes
        (id, resource_kind, resource_id, action, actor_user_id, changed_at, snapshot_json)
        VALUES (
          1, 'site', 'shared-site', 'updated', 'owner-id', '2026-01-01',
          '{"id":"shared-site","name":"Historical Site","visibility":"shared","sharedWith":[{"userId":"legacy-id","role":"editor"}]}'
        );
    `);

    const env = { DB: db as unknown as D1Database };
    db.beforeBatch = () => {
      const site = JSON.parse(
        (db.db.prepare("SELECT payload_json FROM sites WHERE id = 'shared-site'").get() as { payload_json: string })
          .payload_json,
      );
      db.db
        .prepare("UPDATE sites SET payload_json = ? WHERE id = 'shared-site'")
        .run(JSON.stringify({ ...site, concurrentEdit: "preserved" }));
    };
    await reconcileUserIdentityByIdpEmail(env, "stable-id", "user@example.com");

    const site = JSON.parse(
      (db.db.prepare("SELECT payload_json FROM sites WHERE id = 'shared-site'").get() as { payload_json: string }).payload_json,
    );
    const simulation = JSON.parse(
      (db.db.prepare("SELECT payload_json FROM simulations WHERE id = 'shared-simulation'").get() as { payload_json: string }).payload_json,
    );
    expect(site.sharedWith).toEqual([{ userId: "stable-id", role: "editor" }]);
    expect(site.concurrentEdit).toBe("preserved");
    expect(simulation.sharedWith).toEqual([{ userId: "stable-id", role: "editor" }]);

    await expect(
      upsertLibrarySnapshot(
        env,
        { id: "owner-id", isAdmin: false, isModerator: false },
        {
          siteLibrary: [{ ...site, name: "Shared Site Updated" }],
          simulationPresets: [{ ...simulation, name: "Shared Simulation Updated" }],
        },
      ),
    ).resolves.toEqual({ upsertedSites: 1, upsertedSimulations: 1, conflicts: [] });
    expect(db.db.prepare("SELECT user_id, role FROM site_roles WHERE site_id = 'shared-site'").all()).toEqual([
      { user_id: "stable-id", role: "editor" },
    ]);
    expect(
      db.db.prepare("SELECT user_id, role FROM simulation_roles WHERE simulation_id = 'shared-simulation'").all(),
    ).toEqual([{ user_id: "stable-id", role: "editor" }]);

    await expect(
      revertResourceFromChangeCopy(env, "site", "shared-site", 1, {
        id: "owner-id",
        isAdmin: false,
        isModerator: false,
      }),
    ).resolves.toEqual({ ok: true });
    expect(db.db.prepare("SELECT user_id, role FROM site_roles WHERE site_id = 'shared-site'").all()).toEqual([
      { user_id: "stable-id", role: "editor" },
    ]);
  });

  it("rolls back every transfer when the audit insert fails", async () => {
    const db = new SqliteD1();
    seedMigration(db);
    db.db.exec("CREATE TRIGGER reject_identity_audit BEFORE INSERT ON user_identity_audit BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");

    await expect(
      reconcileUserIdentityByIdpEmail({ DB: db as unknown as D1Database }, "stable-id", "user@example.com"),
    ).rejects.toThrow("audit unavailable");

    expect(db.db.prepare("SELECT is_admin FROM users WHERE id = 'stable-id'").get()).toEqual({ is_admin: 0 });
    expect(db.db.prepare("SELECT owner_user_id FROM sites WHERE id = 'site-1'").get()).toEqual({ owner_user_id: "legacy-id" });
    expect(db.db.prepare("SELECT id FROM users WHERE id = 'legacy-id'").get()).toEqual({ id: "legacy-id" });
  });

  it("preserves a durable revocation when the verified identity moves to a new subject", async () => {
    const db = new SqliteD1();
    db.db.exec(`
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_approved, approved_at, approved_by_user_id)
        VALUES ('stable-id', 'new@example.com', 'user@example.com', 1, 1, '2026-02-01', 'system:open-registration');
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_approved, approved_at, approved_by_user_id)
        VALUES ('revoked-id', 'old@example.com', 'user@example.com', 1, 0, '2026-01-01', 'revoked:admin-id');
    `);

    await reconcileUserIdentityByIdpEmail({ DB: db as unknown as D1Database }, "stable-id", "user@example.com");

    expect(db.db.prepare("SELECT is_approved, approved_by_user_id FROM users WHERE id = 'stable-id'").get()).toEqual({
      is_approved: 0,
      approved_by_user_id: "revoked:admin-id",
    });
  });

  it("uses lifecycle state changed immediately before the reconciliation batch", async () => {
    const db = new SqliteD1();
    db.db.exec(`
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_approved, approved_at, approved_by_user_id)
        VALUES ('stable-id', 'new@example.com', 'user@example.com', 1, 1, '2026-02-01', 'system:open-registration');
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_admin, is_approved, approved_at, approved_by_user_id)
        VALUES ('legacy-id', 'old@example.com', 'user@example.com', 1, 1, 1, '2026-01-01', 'legacy-id');
    `);
    db.beforeBatch = () => {
      db.db
        .prepare(
          `UPDATE users
           SET is_admin = 0, is_moderator = 0, is_approved = 0, approved_by_user_id = 'revoked:admin-id'
           WHERE id = 'legacy-id'`,
        )
        .run();
    };

    await reconcileUserIdentityByIdpEmail({ DB: db as unknown as D1Database }, "stable-id", "user@example.com");

    expect(
      db.db
        .prepare("SELECT is_admin, is_moderator, is_approved, approved_by_user_id FROM users WHERE id = 'stable-id'")
        .get(),
    ).toEqual({ is_admin: 0, is_moderator: 0, is_approved: 0, approved_by_user_id: "revoked:admin-id" });
    const audit = db.db
      .prepare("SELECT details_json FROM user_identity_audit WHERE event_type = 'reconciled_by_verified_idp_email'")
      .get() as { details_json: string };
    expect(JSON.parse(audit.details_json)).toMatchObject({
      mergedFromIsAdmin: false,
      mergedFromIsApproved: false,
      mergedFromAccountState: "revoked",
    });
  });

  it("fails closed when the source is deleted immediately before the reconciliation batch", async () => {
    const db = new SqliteD1();
    db.db.exec(`
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_approved, approved_at, approved_by_user_id)
        VALUES ('stable-id', 'new@example.com', 'user@example.com', 1, 1, '2026-02-01', 'system:open-registration');
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_admin, is_approved, approved_at, approved_by_user_id)
        VALUES ('legacy-id', 'old@example.com', 'user@example.com', 1, 1, 1, '2026-01-01', 'legacy-id');
    `);
    db.beforeBatch = () => {
      db.db.exec(`
        INSERT INTO deleted_users VALUES ('legacy-id', '2026-03-01', 'admin-id');
        DELETE FROM users WHERE id = 'legacy-id';
      `);
    };

    await reconcileUserIdentityByIdpEmail({ DB: db as unknown as D1Database }, "stable-id", "user@example.com");

    expect(
      db.db
        .prepare("SELECT is_admin, is_moderator, is_approved, approved_by_user_id FROM users WHERE id = 'stable-id'")
        .get(),
    ).toEqual({ is_admin: 0, is_moderator: 0, is_approved: 0, approved_by_user_id: "revoked:admin-id" });
    const audit = db.db
      .prepare("SELECT details_json FROM user_identity_audit WHERE event_type = 'reconciled_by_verified_idp_email'")
      .get() as { details_json: string };
    expect(JSON.parse(audit.details_json)).toMatchObject({
      mergedFromIsAdmin: false,
      mergedFromIsApproved: false,
      mergedFromAccountState: "revoked",
    });
  });

  it("aborts when the source loses its verified identity match before the reconciliation batch", async () => {
    const db = new SqliteD1();
    db.db.exec(`
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_admin, is_approved)
        VALUES ('stable-id', 'new@example.com', 'user@example.com', 1, 0, 1);
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_admin, is_approved)
        VALUES ('legacy-id', 'old@example.com', 'user@example.com', 1, 1, 1);
    `);
    db.beforeBatch = () => {
      db.db.prepare("UPDATE users SET idp_email = 'other@example.com' WHERE id = 'legacy-id'").run();
    };

    await expect(
      reconcileUserIdentityByIdpEmail({ DB: db as unknown as D1Database }, "stable-id", "user@example.com"),
    ).rejects.toThrow("UNIQUE constraint failed");
    expect(db.db.prepare("SELECT id, is_admin FROM users ORDER BY id").all()).toEqual([
      { id: "legacy-id", is_admin: 1 },
      { id: "stable-id", is_admin: 0 },
    ]);
  });

  it("aborts when a verified identity collision appears before the reconciliation batch", async () => {
    const db = new SqliteD1();
    db.db.exec(`
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_admin, is_approved)
        VALUES ('stable-id', 'new@example.com', 'user@example.com', 1, 0, 1);
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_admin, is_approved)
        VALUES ('legacy-id', 'old@example.com', 'user@example.com', 1, 1, 1);
    `);
    db.beforeBatch = () => {
      db.db.exec(`
        INSERT INTO users (id, email, idp_email, idp_email_verified, is_admin, is_approved)
          VALUES ('collision-id', 'collision@example.com', 'user@example.com', 1, 0, 1);
      `);
    };

    await expect(
      reconcileUserIdentityByIdpEmail({ DB: db as unknown as D1Database }, "stable-id", "user@example.com"),
    ).rejects.toThrow("UNIQUE constraint failed");
    expect(db.db.prepare("SELECT id FROM users ORDER BY id").all()).toEqual([
      { id: "collision-id" },
      { id: "legacy-id" },
      { id: "stable-id" },
    ]);
  });

  it("aborts when the target is deleted immediately before the reconciliation batch", async () => {
    const db = new SqliteD1();
    db.db.exec(`
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_admin, is_approved)
        VALUES ('stable-id', 'new@example.com', 'user@example.com', 1, 0, 1);
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_admin, is_approved)
        VALUES ('legacy-id', 'old@example.com', 'user@example.com', 1, 1, 1);
    `);
    db.beforeBatch = () => {
      db.db.exec(`
        INSERT INTO deleted_users VALUES ('stable-id', '2026-03-01', 'admin-id');
        DELETE FROM users WHERE id = 'stable-id';
      `);
    };

    await expect(
      reconcileUserIdentityByIdpEmail({ DB: db as unknown as D1Database }, "stable-id", "user@example.com"),
    ).rejects.toThrow("UNIQUE constraint failed");
    expect(db.db.prepare("SELECT id, is_admin FROM users").all()).toEqual([{ id: "legacy-id", is_admin: 1 }]);
    expect(db.db.prepare("SELECT id, deleted_by_user_id FROM deleted_users").all()).toEqual([
      { id: "stable-id", deleted_by_user_id: "admin-id" },
    ]);
  });

  it("rolls back target creation so a pending-source reconciliation retry stays pending", async () => {
    const db = new SqliteD1();
    db.db.exec(`
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_approved, approved_at, approved_by_user_id)
        VALUES ('pending-id', 'old@example.com', 'user@example.com', 1, 0, NULL, NULL);
      CREATE TRIGGER reject_reconciliation_audit
        BEFORE INSERT ON user_identity_audit
        WHEN NEW.event_type = 'reconciled_by_verified_idp_email'
        BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;
    `);
    const env = { DB: db as unknown as D1Database };
    const tokenPayload = {
      email: "user@example.com",
      __linksim_verified_idp_email: "user@example.com",
    };

    await expect(ensureUser(env, "stable-id", tokenPayload)).rejects.toThrow("audit unavailable");
    expect(db.db.prepare("SELECT id FROM users WHERE id = 'stable-id'").get()).toBeUndefined();

    db.db.exec("DROP TRIGGER reject_reconciliation_audit");
    await ensureUser(env, "stable-id", tokenPayload);

    expect(
      db.db
        .prepare("SELECT is_approved, approved_at, approved_by_user_id FROM users WHERE id = 'stable-id'")
        .get(),
    ).toEqual({ is_approved: 0, approved_at: null, approved_by_user_id: null });
    expect(db.db.prepare("SELECT id FROM users WHERE id = 'pending-id'").get()).toBeUndefined();
  });

  it("does not recreate a user deleted immediately before the atomic ensure batch", async () => {
    const db = new SqliteD1();
    db.db.exec(`
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_approved, approved_at, approved_by_user_id)
        VALUES ('stable-id', 'user@example.com', 'user@example.com', 1, 1, '2026-01-01', 'system:open-registration');
    `);
    db.beforeBatch = () => {
      db.db.exec(`
        INSERT INTO deleted_users VALUES ('stable-id', '2026-03-01', 'admin-id');
        DELETE FROM users WHERE id = 'stable-id';
      `);
    };

    await expect(
      ensureUser(
        { DB: db as unknown as D1Database },
        "stable-id",
        { email: "user@example.com", __linksim_verified_idp_email: "user@example.com" },
      ),
    ).rejects.toThrow("UNIQUE constraint failed");
    expect(db.db.prepare("SELECT id FROM users WHERE id = 'stable-id'").get()).toBeUndefined();
    expect(db.db.prepare("SELECT id, deleted_by_user_id FROM deleted_users WHERE id = 'stable-id'").get()).toEqual({
      id: "stable-id",
      deleted_by_user_id: "admin-id",
    });
  });

  it("aborts when a revoked matching source appears before a zero-candidate ensure batch", async () => {
    const db = new SqliteD1();
    db.beforeBatch = () => {
      db.db.exec(`
        INSERT INTO users
          (id, email, idp_email, idp_email_verified, is_approved, approved_at, approved_by_user_id)
          VALUES ('revoked-id', 'old@example.com', 'user@example.com', 1, 0, '2026-01-01', 'revoked:admin-id');
      `);
    };

    await expect(
      ensureUser(
        { DB: db as unknown as D1Database },
        "stable-id",
        { email: "user@example.com", __linksim_verified_idp_email: "user@example.com" },
      ),
    ).rejects.toThrow("UNIQUE constraint failed");
    expect(db.db.prepare("SELECT id FROM users WHERE id = 'stable-id'").get()).toBeUndefined();
    expect(
      db.db.prepare("SELECT id, is_approved, approved_by_user_id FROM users WHERE id = 'revoked-id'").get(),
    ).toEqual({ id: "revoked-id", is_approved: 0, approved_by_user_id: "revoked:admin-id" });
  });

  it("preserves pending state when a verified identity first moves to a new subject", async () => {
    const db = new SqliteD1();
    db.db.exec(`
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_approved, approved_at, approved_by_user_id)
        VALUES ('stable-id', 'new@example.com', 'user@example.com', 1, 1, '2026-02-01', 'system:open-registration');
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_approved, approved_at, approved_by_user_id)
        VALUES ('pending-id', 'old@example.com', 'user@example.com', 1, 0, NULL, NULL);
    `);

    await reconcileUserIdentityByIdpEmail({ DB: db as unknown as D1Database }, "stable-id", "user@example.com");

    expect(db.db.prepare("SELECT is_approved, approved_at, approved_by_user_id FROM users WHERE id = 'stable-id'").get()).toEqual({
      is_approved: 0,
      approved_at: null,
      approved_by_user_id: null,
    });
  });

  it("does not reconcile from mutable profile email", async () => {
    const db = new SqliteD1();
    db.db.exec(`
      INSERT INTO users (id, email, idp_email, idp_email_verified) VALUES ('stable-id', 'new@example.com', 'user@example.com', 1);
      INSERT INTO users (id, email, idp_email, idp_email_verified, is_admin) VALUES ('editable-id', 'user@example.com', 'other@example.com', 1, 1);
    `);

    await reconcileUserIdentityByIdpEmail({ DB: db as unknown as D1Database }, "stable-id", "user@example.com");

    expect(db.db.prepare("SELECT is_admin FROM users WHERE id = 'stable-id'").get()).toEqual({ is_admin: 0 });
    expect(db.db.prepare("SELECT id FROM users WHERE id = 'editable-id'").get()).toEqual({ id: "editable-id" });
  });

  it("audits a verified identity collision and transfers nothing", async () => {
    const db = new SqliteD1();
    db.db.exec(`
      INSERT INTO users (id, idp_email, idp_email_verified) VALUES ('stable-id', 'user@example.com', 1);
      INSERT INTO users (id, idp_email, idp_email_verified) VALUES ('one', 'user@example.com', 1);
      INSERT INTO users (id, idp_email, idp_email_verified) VALUES ('two', 'user@example.com', 1);
    `);

    await expect(
      reconcileUserIdentityByIdpEmail({ DB: db as unknown as D1Database }, "stable-id", "user@example.com"),
    ).rejects.toThrow("Verified identity collision");
    expect(db.db.prepare("SELECT COUNT(*) AS count FROM users").get()).toEqual({ count: 3 });
    expect(db.db.prepare("SELECT event_type FROM user_identity_audit").get()).toEqual({
      event_type: "verified_idp_email_collision",
    });
  });

  it("keeps deletion blocks durable until explicit restore", () => {
    expect(() => assertDeletedUserMayRegister({ deleted_at: "2026-01-01T00:00:00Z" })).toThrow("Session revoked by admin");
    expect(() => assertDeletedUserMayRegister(null)).not.toThrow();
  });

  it("blocks a new subject that presents the deleted account's verified identity", async () => {
    const db = new SqliteD1();
    db.db.exec(`
      INSERT INTO deleted_users VALUES ('old-subject', '2026-01-01', 'admin-id');
      INSERT INTO user_identity_audit
        (event_type, target_user_id, actor_user_id, idp_email, details_json, created_at)
        VALUES ('user_deleted', 'old-subject', 'admin-id', 'user@example.com', '{}', '2026-01-01');
    `);

    const deletion = await findDeletionBlock(
      { DB: db as unknown as D1Database },
      "new-subject",
      "user@example.com",
    );

    expect(deletion).toEqual({ deleted_at: "2026-01-01" });
    db.db.exec("DELETE FROM deleted_users WHERE id = 'old-subject'");
    await expect(findDeletionBlock(
      { DB: db as unknown as D1Database },
      "new-subject",
      "user@example.com",
    )).resolves.toBeNull();
  });

  it("applies bootstrap admin only when creating the user", () => {
    expect(shouldBootstrapAdmin(false, true)).toBe(true);
    expect(shouldBootstrapAdmin(true, true)).toBe(false);
  });
});
