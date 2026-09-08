import { DatabaseSync } from "node:sqlite";

class SqliteStatement {
  values: unknown[] = [];

  constructor(
    private readonly db: DatabaseSync,
    readonly sql: string,
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

export class SqliteD1 {
  readonly db = new DatabaseSync(":memory:");
  readonly statements: SqliteStatement[] = [];
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
      CREATE INDEX idx_resource_changes_lookup ON resource_changes(resource_kind, resource_id, changed_at DESC);
      CREATE INDEX idx_sites_owner ON sites(owner_user_id);
      CREATE INDEX idx_simulations_owner ON simulations(owner_user_id);
      CREATE INDEX idx_sites_visibility ON sites(visibility);
      CREATE INDEX idx_simulations_visibility ON simulations(visibility);
      CREATE INDEX idx_simulations_status ON simulations(status);
      CREATE INDEX idx_site_roles_user ON site_roles(user_id);
      CREATE INDEX idx_simulation_roles_user ON simulation_roles(user_id);
      CREATE INDEX idx_identity_claims_current_user ON verified_identity_claims(current_user_id, status);
    `);
  }

  prepare(sql: string) {
    const statement = new SqliteStatement(this.db, sql, this);
    this.statements.push(statement);
    return statement;
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

