import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { fetchLibraryForUser } from "./db";

class Statement {
  private values: unknown[] = [];
  constructor(private readonly db: DatabaseSync, private readonly sql: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T>() { return { results: this.db.prepare(this.sql).all(...this.values as never[]) as T[] }; }
  async first<T>() { return (this.db.prepare(this.sql).get(...this.values as never[]) as T | undefined) ?? null; }
  async run() { this.db.prepare(this.sql).run(...this.values as never[]); return { success: true }; }
}

class TestD1 {
  readonly db = new DatabaseSync(":memory:");
  constructor() {
    this.db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY, username TEXT, email TEXT, username_set_at TEXT, bio TEXT, access_request_note TEXT,
        idp_email TEXT, idp_email_verified INTEGER NOT NULL DEFAULT 0, avatar_url TEXT, email_public INTEGER,
        default_frequency_preset_id TEXT, simulation_defaults_preference_json TEXT, basemap_preferences_json TEXT, avatar_object_key TEXT,
        avatar_thumb_key TEXT, avatar_hash TEXT, avatar_bytes INTEGER, avatar_content_type TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0, is_moderator INTEGER NOT NULL DEFAULT 0,
        is_approved INTEGER NOT NULL DEFAULT 0, approved_at TEXT, approved_by_user_id TEXT, created_at TEXT, updated_at TEXT
      );
      CREATE TABLE deleted_users (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL, deleted_by_user_id TEXT);
      CREATE TABLE verified_identity_claims (normalized_email TEXT PRIMARY KEY, current_user_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, blocked_at TEXT, blocked_by_user_id TEXT);
      CREATE TABLE identity_subject_states (user_id TEXT PRIMARY KEY, normalized_email TEXT, status TEXT NOT NULL, canonical_user_id TEXT, bootstrap_consumed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, changed_by_user_id TEXT);
      CREATE TABLE identity_lifecycle_meta (singleton INTEGER PRIMARY KEY, version TEXT NOT NULL, applied_at TEXT NOT NULL);
      INSERT INTO identity_lifecycle_meta VALUES (1, '2026-08-12-identity-lifecycle-v1', '2026-08-12');
      CREATE TABLE user_identity_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, target_user_id TEXT NOT NULL, source_user_id TEXT, actor_user_id TEXT, idp_email TEXT, details_json TEXT, created_at TEXT NOT NULL);
      CREATE TABLE sites (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, created_by_user_id TEXT, last_edited_by_user_id TEXT, created_at TEXT, last_edited_at TEXT, name TEXT, visibility TEXT, payload_json TEXT, updated_at TEXT);
      CREATE TABLE simulations (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, created_by_user_id TEXT, last_edited_by_user_id TEXT, created_at TEXT, last_edited_at TEXT, name TEXT, visibility TEXT, status TEXT DEFAULT 'active', payload_json TEXT, updated_at TEXT);
      CREATE TABLE site_roles (site_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (site_id, user_id));
      CREATE TABLE simulation_roles (simulation_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (simulation_id, user_id));
      CREATE TABLE resource_changes (id INTEGER PRIMARY KEY, resource_kind TEXT, resource_id TEXT, action TEXT, actor_user_id TEXT NOT NULL, changed_at TEXT, note TEXT, details_json TEXT, snapshot_json TEXT);
      CREATE TABLE simulation_path_leaderboard_entries (simulation_id TEXT, canonical_path_key TEXT, owner_user_id TEXT NOT NULL, from_site_id TEXT, to_site_id TEXT, link_id TEXT, path_label TEXT, simulation_name TEXT, distance_km REAL, rx_after_env_loss_dbm REAL, rx_margin_db REAL, terrain_obstructed INTEGER, terrain_dataset TEXT, terrain_tile_signature TEXT, simulation_updated_at TEXT, created_at TEXT, updated_at TEXT, PRIMARY KEY (simulation_id, canonical_path_key));
      INSERT INTO users (id, username, is_approved, is_admin, is_moderator) VALUES ('reader', 'Reader', 1, 0, 0), ('other', 'Other', 1, 0, 0);
    `);
  }
  prepare(sql: string) { return new Statement(this.db, sql); }
  async batch(statements: Statement[]) { for (const statement of statements) await statement.run(); return []; }
}

const envFor = (db: TestD1) => ({ DB: db as unknown as D1Database });
const insertSite = (db: TestD1, id: string, owner: string, visibility: string, updatedAt: string) => {
  db.db.prepare("INSERT INTO sites (id, owner_user_id, name, visibility, payload_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, owner, id, visibility, JSON.stringify({ id, name: id }), updatedAt);
};

describe("fetchLibraryForUser pagination", () => {
  it("uses ID keysets, an inclusive delta boundary, and a fixed cutoff", async () => {
    const db = new TestD1();
    for (let index = 0; index < 25; index += 1) insertSite(db, `site-${String(index).padStart(2, "0")}`, "reader", "private", "2026-08-14T10:00:00.000Z");
    insertSite(db, "site-later", "reader", "private", "2026-08-14T10:00:02.000Z");
    insertSite(db, "site-hidden", "other", "private", "2026-08-14T10:00:00.000Z");

    const first = await fetchLibraryForUser(envFor(db), "reader", {
      since: "2026-08-14T10:00:00.000Z", cutoff: "2026-08-14T10:00:01.000Z",
      phase: "sites", afterId: "", limit: 20,
    });
    expect(first.siteLibrary).toHaveLength(20);
    expect(first.siteLibrary[0]?.id).toBe("site-00");
    expect(first.nextCursor).toEqual({ phase: "sites", afterId: "site-19" });

    const second = await fetchLibraryForUser(envFor(db), "reader", {
      since: "2026-08-14T10:00:00.000Z", cutoff: "2026-08-14T10:00:01.000Z",
      phase: "sites", afterId: first.nextCursor?.afterId, limit: 20,
    });
    expect(second.siteLibrary.map((site) => site.id)).toEqual(["site-20", "site-21", "site-22", "site-23", "site-24"]);
    expect(second.nextCursor).toEqual({ phase: "deleted_sites", afterId: "" });
  });

  it("preserves deleted Site tombstone audience checks within the requested window", async () => {
    const db = new TestD1();
    db.db.prepare("INSERT INTO resource_changes (id, resource_kind, resource_id, actor_user_id, changed_at, note, snapshot_json) VALUES (1, 'site', 'visible-delete', 'other', ?, 'Deleted Site', ?)")
      .run("2026-08-14T10:00:00.000Z", JSON.stringify({ ownerUserId: "reader", visibility: "private", sharedWith: [] }));
    db.db.prepare("INSERT INTO resource_changes (id, resource_kind, resource_id, actor_user_id, changed_at, note, snapshot_json) VALUES (2, 'site', 'hidden-delete', 'other', ?, 'Deleted Site', ?)")
      .run("2026-08-14T10:00:00.000Z", JSON.stringify({ ownerUserId: "other", visibility: "private", sharedWith: [] }));

    const page = await fetchLibraryForUser(envFor(db), "reader", {
      since: "2026-08-14T10:00:00.000Z", cutoff: "2026-08-14T10:00:00.000Z",
      phase: "deleted_sites", afterId: "", limit: 20,
    });
    expect(page.deletedSiteIds).toEqual(["visible-delete"]);
  });

  it("uses the first audit entry's before-state to signal legacy visibility revocations", async () => {
    const db = new TestD1();
    insertSite(db, "site-legacy-revoked", "other", "private", "2026-08-14T10:00:01.000Z");
    insertSite(db, "site-legacy-grant-revoked", "other", "private", "2026-08-14T10:00:01.000Z");
    db.db.prepare("INSERT INTO simulations (id, owner_user_id, name, visibility, status, payload_json, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)")
      .run(
        "sim-legacy-revoked",
        "other",
        "sim-legacy-revoked",
        "private",
        JSON.stringify({ id: "sim-legacy-revoked", name: "sim-legacy-revoked", visibility: "private" }),
        "2026-08-14T10:00:01.000Z",
      );
    const beforeState = JSON.stringify({ diff: { visibility: { before: "public", after: "private" } } });
    for (const [id, kind, resourceId] of [
      [1, "site", "site-legacy-revoked"],
      [2, "simulation", "sim-legacy-revoked"],
    ] as const) {
      db.db.prepare("INSERT INTO resource_changes (id, resource_kind, resource_id, actor_user_id, changed_at, details_json, snapshot_json) VALUES (?, ?, ?, 'other', ?, ?, ?)")
        .run(id, kind, resourceId, "2026-08-14T10:00:01.000Z", beforeState, JSON.stringify({ visibility: "private", sharedWith: [] }));
    }
    db.db.prepare("INSERT INTO resource_changes (id, resource_kind, resource_id, actor_user_id, changed_at, details_json, snapshot_json) VALUES (3, 'site', 'site-legacy-grant-revoked', 'other', ?, ?, ?)")
      .run(
        "2026-08-14T10:00:01.000Z",
        JSON.stringify({ diff: { sharedWith: { before: [{ userId: "reader", role: "viewer" }], after: [] } } }),
        JSON.stringify({ visibility: "private", sharedWith: [] }),
      );

    const delta = await fetchLibraryForUser(envFor(db), "reader", {
      since: "2026-08-14T10:00:00.000Z",
      cutoff: "2026-08-14T10:00:02.000Z",
    });
    expect(delta.removedSiteIds).toEqual(expect.arrayContaining(["site-legacy-revoked", "site-legacy-grant-revoked"]));
    expect(delta.removedSiteIds).toHaveLength(2);
    expect(delta.removedSimulationIds).toEqual(["sim-legacy-revoked"]);
  });

  it("recovers a row changed after an earlier page even when its ID is behind that page's keyset", async () => {
    const db = new TestD1();
    insertSite(db, "site-a", "reader", "private", "2026-08-14T10:00:00.000Z");
    insertSite(db, "site-z", "reader", "private", "2026-08-14T10:00:00.000Z");

    const basePage = await fetchLibraryForUser(envFor(db), "reader", {
      cutoff: "2026-08-14T10:00:00.000Z", phase: "sites", afterId: "", limit: 1,
    });
    expect(basePage.siteLibrary.map((site) => site.id)).toEqual(["site-a"]);

    db.db.prepare("UPDATE sites SET payload_json = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify({ id: "site-a", name: "Recovered" }), "2026-08-14T10:00:00.000Z", "site-a");

    const remainingBase = await fetchLibraryForUser(envFor(db), "reader", {
      cutoff: "2026-08-14T10:00:00.000Z", phase: "sites", afterId: "site-a", limit: 20,
    });
    expect(remainingBase.siteLibrary.map((site) => site.id)).toEqual(["site-z"]);

    const recovery = await fetchLibraryForUser(envFor(db), "reader", {
      since: "2026-08-14T10:00:00.000Z", cutoff: "2026-08-14T10:00:01.000Z",
      phase: "sites", afterId: "", limit: 20,
    });
    expect(recovery.siteLibrary).toEqual(expect.arrayContaining([expect.objectContaining({ id: "site-a", name: "Recovered" })]));
  });
});
