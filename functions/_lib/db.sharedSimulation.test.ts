import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLibraryForUser, fetchPublicSimulationBundle, setSimulationLifecycleStatus, upsertLibrarySnapshot } from "./db";

type AnyRow = Record<string, unknown>;

const TABLE_COLUMNS: Record<string, string[]> = {
  users: [
    "id",
    "username",
    "email",
    "username_set_at",
    "bio",
    "access_request_note",
    "idp_email",
    "idp_email_verified",
    "avatar_url",
    "email_public",
    "default_frequency_preset_id",
    "simulation_defaults_preference_json",
    "avatar_object_key",
    "avatar_thumb_key",
    "avatar_hash",
    "avatar_bytes",
    "avatar_content_type",
    "is_admin",
    "is_moderator",
    "is_approved",
    "approved_at",
    "approved_by_user_id",
    "created_at",
    "updated_at",
  ],
  sites: [
    "id",
    "owner_user_id",
    "created_by_user_id",
    "last_edited_by_user_id",
    "created_at",
    "last_edited_at",
    "name",
    "visibility",
    "payload_json",
    "updated_at",
  ],
  simulations: [
    "id",
    "owner_user_id",
    "created_by_user_id",
    "last_edited_by_user_id",
    "created_at",
    "last_edited_at",
    "name",
    "visibility",
    "status",
    "payload_json",
    "updated_at",
  ],
  deleted_users: ["id", "deleted_at", "deleted_by_user_id"],
  site_roles: ["site_id", "user_id", "role", "created_at"],
  simulation_roles: ["simulation_id", "user_id", "role", "created_at"],
  resource_changes: [
    "id",
    "resource_kind",
    "resource_id",
    "action",
    "actor_user_id",
    "changed_at",
    "note",
    "details_json",
    "snapshot_json",
  ],
  simulation_path_leaderboard_entries: [
    "simulation_id",
    "canonical_path_key",
    "owner_user_id",
    "from_site_id",
    "to_site_id",
    "link_id",
    "path_label",
    "simulation_name",
    "distance_km",
    "rx_after_env_loss_dbm",
    "rx_margin_db",
    "terrain_obstructed",
    "terrain_dataset",
    "terrain_tile_signature",
    "simulation_updated_at",
    "created_at",
    "updated_at",
  ],
  user_identity_audit: [
    "id",
    "event_type",
    "target_user_id",
    "source_user_id",
    "actor_user_id",
    "idp_email",
    "details_json",
    "created_at",
  ],
};

class FakeStatement {
  private bound: unknown[] = [];

  constructor(
    private readonly db: FakeDb,
    private readonly sql: string,
  ) {}

  bind(...args: unknown[]): FakeStatement {
    this.bound = args;
    return this;
  }

  async first<T>(): Promise<T | null> {
    return this.db.first(this.sql, this.bound) as T | null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: this.db.all(this.sql, this.bound) as T[] };
  }

  async run(): Promise<{ success: boolean }> {
    this.db.run(this.sql, this.bound);
    return { success: true };
  }
}

class FakeDb {
  readonly sites = new Map<string, AnyRow>();
  readonly simulations = new Map<string, AnyRow>();
  readonly simulationRoles = new Map<string, string>();
  readonly resourceChanges: AnyRow[] = [];
  readonly adminUserIds = new Set<string>();

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  async batch(statements: Array<{ run: () => Promise<unknown> }>): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }

  first(sql: string, bound: unknown[]): AnyRow | null {
    if (sql.includes("FROM users WHERE id = ?")) {
      const id = String(bound[0] ?? "");
      return {
        id,
        username: id,
        email: `${id}@example.test`,
        username_set_at: "2026-01-01T00:00:00.000Z",
        bio: "",
        access_request_note: "",
        idp_email: "",
        idp_email_verified: 0,
        avatar_url: "",
        email_public: 1,
        default_frequency_preset_id: null,
        simulation_defaults_preference_json: null,
        avatar_object_key: null,
        avatar_thumb_key: null,
        avatar_hash: null,
        avatar_bytes: null,
        avatar_content_type: null,
        is_admin: this.adminUserIds.has(id) ? 1 : 0,
        is_moderator: 0,
        is_approved: 1,
        approved_at: null,
        approved_by_user_id: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: null,
      };
    }
    if (sql.includes("SELECT id, owner_user_id, status, payload_json FROM simulations")) {
      return this.simulations.get(String(bound[0] ?? "")) ?? null;
    }
    if (sql.includes("FROM simulations t") && sql.includes("LEFT JOIN simulation_roles")) {
      const id = String(bound[1] ?? "");
      return this.simulations.get(id) ?? null;
    }
    if (sql.includes("FROM sites t") && sql.includes("LEFT JOIN site_roles")) {
      const id = String(bound[1] ?? "");
      return this.sites.get(id) ?? null;
    }
    if (sql.includes("SELECT id FROM simulations WHERE lower(name) = lower(?)")) {
      const name = String(bound[0] ?? "").trim().toLowerCase();
      const ownerUserId = String(bound[1] ?? "");
      const id = String(bound[2] ?? "");
      for (const row of this.simulations.values()) {
        if (String(row.name ?? "").trim().toLowerCase() === name && row.owner_user_id === ownerUserId && row.id !== id) {
          return { id: row.id };
        }
      }
      return null;
    }
    if (sql.includes("SELECT id, visibility FROM sites WHERE id = ?")) {
      const id = String(bound[0] ?? "");
      const row = this.sites.get(id);
      if (!row) return null;
      return { id: row.id, visibility: row.visibility };
    }
    if (sql.includes("FROM simulations WHERE id = ?") && sql.includes("payload_json")) {
      const id = String(bound[0] ?? "");
      return this.simulations.get(id) ?? null;
    }
    if (sql.includes("SELECT role FROM simulation_roles")) {
      const simulationId = String(bound[0] ?? "");
      const userId = String(bound[1] ?? "");
      const role = this.simulationRoles.get(`${simulationId}:${userId}`);
      return role ? { role } : null;
    }
    return null;
  }

  all(sql: string, bound: unknown[] = []): AnyRow[] {
    const pragmaMatch = sql.match(/^PRAGMA table_info\(([^)]+)\)$/i);
    if (pragmaMatch) {
      const table = pragmaMatch[1] ?? "";
      return (TABLE_COLUMNS[table] ?? []).map((name) => ({ name }));
    }
    if (sql.includes("SELECT id, payload_json, visibility FROM sites WHERE id IN")) {
      return bound.map((id) => this.sites.get(String(id))).filter((row): row is AnyRow => Boolean(row));
    }
    if (sql.includes("SELECT s.id") && sql.includes("s.status = 'deleted'")) {
      const userId = String(bound[1] ?? "");
      return [...this.simulations.values()]
        .filter((row) => row.status === "deleted" && (row.owner_user_id === userId || row.visibility !== "private"))
        .map((row) => ({ id: row.id }));
    }
    if (sql.includes("SELECT s.payload_json") && sql.includes("FROM simulations s")) {
      const userId = String(bound[2] ?? "");
      const isAdmin = Number(bound[1] ?? 0) === 1;
      return [...this.simulations.values()]
        .filter((row) => (isAdmin || row.status === "active") && (isAdmin || row.owner_user_id === userId || row.visibility !== "private"))
        .map((row) => ({
          ...row,
          role: null,
          owner_name: String(row.owner_user_id),
          owner_avatar_url: "",
          created_by_name: null,
          created_by_avatar_url: null,
          first_actor_user_id: null,
          first_actor_name: null,
          first_actor_avatar_url: null,
          last_edited_by_name: null,
          last_edited_by_avatar_url: null,
          last_actor_user_id: null,
          last_actor_name: null,
          last_actor_avatar_url: null,
        }));
    }
    if (sql.includes("SELECT s.payload_json") && sql.includes("FROM sites s")) return [];
    return [];
  }

  run(sql: string, bound: unknown[]): void {
    if (sql.includes("INSERT INTO simulations")) {
      const [id, ownerUserId, createdByUserId, lastEditedByUserId, createdAt, lastEditedAt, name, visibility, payloadJson, updatedAt] =
        bound;
      this.simulations.set(String(id), {
        id,
        owner_user_id: ownerUserId,
        created_by_user_id: createdByUserId,
        last_edited_by_user_id: lastEditedByUserId,
        created_at: createdAt,
        last_edited_at: lastEditedAt,
        name,
        visibility,
        status: "active",
        payload_json: payloadJson,
        updated_at: updatedAt,
      });
      return;
    }
    if (sql.includes("INSERT INTO sites")) {
      const [id, ownerUserId, createdByUserId, lastEditedByUserId, createdAt, lastEditedAt, name, visibility, payloadJson, updatedAt] =
        bound;
      this.sites.set(String(id), {
        id,
        owner_user_id: ownerUserId,
        created_by_user_id: createdByUserId,
        last_edited_by_user_id: lastEditedByUserId,
        created_at: createdAt,
        last_edited_at: lastEditedAt,
        name,
        visibility,
        payload_json: payloadJson,
        updated_at: updatedAt,
      });
      return;
    }
    if (sql.includes("INSERT INTO resource_changes")) {
      const [resourceKind, resourceId, action, actorUserId, changedAt, note, detailsJson, snapshotJson] = bound;
      this.resourceChanges.push({
        resource_kind: resourceKind,
        resource_id: resourceId,
        action,
        actor_user_id: actorUserId,
        changed_at: changedAt,
        note,
        details_json: detailsJson,
        snapshot_json: snapshotJson,
      });
      return;
    }
    if (sql.includes("UPDATE simulations") && sql.includes("SET status = ?")) {
      const [status, payloadJson, updatedAt, lastEditedAt, lastEditedByUserId, id] = bound;
      const current = this.simulations.get(String(id));
      if (current) {
        this.simulations.set(String(id), {
          ...current,
          status,
          payload_json: payloadJson,
          updated_at: updatedAt,
          last_edited_at: lastEditedAt,
          last_edited_by_user_id: lastEditedByUserId,
        });
      }
      return;
    }
    if (sql.includes("DELETE FROM site_roles") || sql.includes("DELETE FROM simulation_roles")) {
      return;
    }
  }
}

describe("upsertLibrarySnapshot shared simulations", () => {
  it("allows a shared simulation to reference a private site entry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T12:00:00.000Z"));

    const db = new FakeDb();
    db.sites.set("site-private", {
      id: "site-private",
      owner_user_id: "owner-1",
      created_by_user_id: "owner-1",
      last_edited_by_user_id: "owner-1",
      created_at: "2026-04-17T11:59:00.000Z",
      last_edited_at: "2026-04-17T11:59:00.000Z",
      name: "Private Site",
      visibility: "private",
      payload_json: JSON.stringify({ id: "site-private", visibility: "private" }),
      updated_at: "2026-04-17T11:59:00.000Z",
    });

    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];
    const result = await upsertLibrarySnapshot(
      env,
      { id: "owner-1", isAdmin: false, isModerator: false },
      {
        siteLibrary: [],
        simulationPresets: [
          {
            id: "sim-1",
            name: "Shared Relay",
            visibility: "shared",
            sharedWith: [{ userId: "collab-1", role: "viewer" }],
            ownerUserId: "owner-1",
            createdByUserId: "owner-1",
            createdByName: "Owner",
            createdByAvatarUrl: "",
            lastEditedByUserId: "owner-1",
            lastEditedByName: "Owner",
            lastEditedByAvatarUrl: "",
            updatedAt: "2026-04-17T11:59:30.000Z",
            snapshot: {
              sites: [
                {
                  id: "site-a",
                  name: "Private Site Ref",
                  position: { lat: 59.1, lon: 10.1 },
                  groundElevationM: 100,
                  antennaHeightM: 2,
                  txPowerDbm: 22,
                  txGainDbi: 5,
                  rxGainDbi: 5,
                  cableLossDb: 1,
                  libraryEntryId: "site-private",
                },
              ],
              links: [],
              systems: [],
              networks: [],
              selectedSiteId: "site-a",
              selectedLinkId: "",
              selectedNetworkId: "",
              selectedCoverageResolution: "24",
              propagationModel: "ITM",
              selectedFrequencyPresetId: "custom",
              rxSensitivityTargetDbm: -120,
              environmentLossDb: 0,
              propagationEnvironment: {
                radioClimate: "Continental Temperate",
                polarization: "Vertical",
                clutterHeightM: 3,
                groundDielectric: 15,
                groundConductivity: 0.005,
                atmosphericBendingNUnits: 301,
              },
              autoPropagationEnvironment: true,
              terrainDataset: "copernicus30",
            },
            effectiveRole: "owner",
          } as never,
        ],
      },
    );

    expect(result).toEqual({ upsertedSites: 0, upsertedSimulations: 1, conflicts: [] });
    const stored = db.simulations.get("sim-1");
    expect(stored).toBeTruthy();
    expect(stored?.visibility).toBe("public_write");
    const payload = JSON.parse(String(stored?.payload_json ?? "{}")) as { snapshot?: { sites?: Array<{ libraryEntryId?: string }> } };
    expect(payload.snapshot?.sites?.[0]?.libraryEntryId).toBe("site-private");
  });

  const createPrivateBundleDb = () => {
    const db = new FakeDb();
    db.sites.set("site-private", {
      id: "site-private",
      owner_user_id: "owner-1",
      visibility: "private",
      payload_json: JSON.stringify({ id: "site-private", name: "Private Site" }),
    });
    db.simulations.set("sim-private", {
      id: "sim-private",
      owner_user_id: "owner-1",
      visibility: "private",
      status: "active",
      payload_json: JSON.stringify({
        id: "sim-private",
        visibility: "private",
        snapshot: { sites: [{ id: "site-a", libraryEntryId: "site-private" }], links: [] },
      }),
    });
    return db;
  };

  it("rejects anonymous and unrelated access to private simulation bundles", async () => {
    const db = createPrivateBundleDb();
    const env = { DB: db } as unknown as Parameters<typeof fetchPublicSimulationBundle>[0];

    await expect(fetchPublicSimulationBundle(env, { simulationId: "sim-private", actor: null }))
      .resolves.toEqual({ status: "forbidden" });
    await expect(fetchPublicSimulationBundle(env, {
      simulationId: "sim-private",
      actor: { id: "other-1", isAdmin: false, isModerator: false },
    })).resolves.toEqual({ status: "forbidden" });
  });

  it("loads private simulation bundles for owners, collaborators, and admins", async () => {
    const db = createPrivateBundleDb();
    db.simulationRoles.set("sim-private:collab-1", "viewer");
    const env = { DB: db } as unknown as Parameters<typeof fetchPublicSimulationBundle>[0];

    for (const actor of [
      { id: "owner-1", isAdmin: false, isModerator: false },
      { id: "collab-1", isAdmin: false, isModerator: false },
      { id: "admin-1", isAdmin: true, isModerator: false },
    ]) {
      const result = await fetchPublicSimulationBundle(env, { simulationId: "sim-private", actor });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") continue;
      expect(result.sites).toEqual([expect.objectContaining({ id: "site-private", visibility: "private" })]);
    }
  });

  it("loads referenced private sites through an anonymous shared simulation bundle", async () => {
    const db = createPrivateBundleDb();
    const simulation = db.simulations.get("sim-private");
    db.simulations.set("sim-shared", {
      ...simulation,
      id: "sim-shared",
      visibility: "public_write",
      payload_json: JSON.stringify({
        id: "sim-shared",
        visibility: "shared",
        snapshot: { sites: [{ id: "site-a", libraryEntryId: "site-private" }], links: [] },
      }),
    });

    const result = await fetchPublicSimulationBundle(
      { DB: db } as unknown as Parameters<typeof fetchPublicSimulationBundle>[0],
      { simulationId: "sim-shared", actor: null },
    );

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.sites).toEqual([expect.objectContaining({ id: "site-private", visibility: "private" })]);
  });

  it("soft deletes for owners and restores only for platform admins", async () => {
    const db = createPrivateBundleDb();
    const env = { DB: db } as unknown as Parameters<typeof setSimulationLifecycleStatus>[0];

    await expect(
      setSimulationLifecycleStatus(env, { id: "editor-1", isAdmin: false, isModerator: false }, "sim-private", "deleted"),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(
      setSimulationLifecycleStatus(env, { id: "owner-1", isAdmin: false, isModerator: false }, "sim-private", "deleted"),
    ).resolves.toEqual({ ok: true, simulationId: "sim-private", status: "deleted" });
    expect(db.simulations.get("sim-private")?.status).toBe("deleted");
    expect(db.simulationRoles).toBeDefined();
    await expect(
      setSimulationLifecycleStatus(env, { id: "owner-1", isAdmin: false, isModerator: false }, "sim-private", "active"),
    ).resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(
      setSimulationLifecycleStatus(env, { id: "admin-1", isAdmin: true, isModerator: false }, "sim-private", "active"),
    ).resolves.toEqual({ ok: true, simulationId: "sim-private", status: "active" });
    expect(db.simulations.get("sim-private")?.status).toBe("active");
    expect(db.resourceChanges.map((change) => change.note)).toEqual(["Deleted Simulation", "Restored Simulation"]);
  });

  it("rejects stale upserts and public loading for deleted Simulations", async () => {
    const db = createPrivateBundleDb();
    db.simulations.set("sim-private", { ...db.simulations.get("sim-private"), status: "deleted" });
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];

    const upsert = await upsertLibrarySnapshot(
      env,
      { id: "owner-1", isAdmin: false, isModerator: false },
      { siteLibrary: [], simulationPresets: [{ id: "sim-private", name: "Private", visibility: "private" }] },
    );
    expect(upsert.conflicts).toContain("simulation_deleted");
    await expect(
      fetchPublicSimulationBundle(env, {
        simulationId: "sim-private",
        actor: { id: "admin-1", isAdmin: true, isModerator: false },
      }),
    ).resolves.toEqual({ status: "missing" });
  });

  it("returns tombstones to former readers and deleted records only to admins", async () => {
    const db = createPrivateBundleDb();
    db.simulations.set("sim-deleted", {
      id: "sim-deleted",
      owner_user_id: "owner-1",
      created_by_user_id: "owner-1",
      last_edited_by_user_id: "owner-1",
      created_at: "2026-01-01T00:00:00.000Z",
      last_edited_at: "2026-01-02T00:00:00.000Z",
      name: "Deleted",
      visibility: "public_read",
      status: "deleted",
      payload_json: JSON.stringify({ id: "sim-deleted", name: "Deleted", updatedAt: "2026-01-02T00:00:00.000Z" }),
      updated_at: "2026-01-02T00:00:00.000Z",
    });
    db.adminUserIds.add("admin-1");
    const env = { DB: db } as unknown as Parameters<typeof fetchLibraryForUser>[0];

    const ownerLibrary = await fetchLibraryForUser(env, "owner-1");
    expect(ownerLibrary.simulationPresets.map((simulation) => simulation.id)).toEqual(["sim-private"]);
    expect(ownerLibrary.deletedSimulationIds).toEqual(["sim-deleted"]);

    const adminLibrary = await fetchLibraryForUser(env, "admin-1");
    expect(adminLibrary.deletedSimulationIds).toEqual([]);
    expect(adminLibrary.simulationPresets).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "sim-deleted", status: "deleted" })]),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
