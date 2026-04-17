import { afterEach, describe, expect, it, vi } from "vitest";
import { upsertLibrarySnapshot } from "./db";

type AnyRow = Record<string, unknown>;

const TABLE_COLUMNS: Record<string, string[]> = {
  users: [
    "id",
    "username",
    "email",
    "bio",
    "access_request_note",
    "idp_email",
    "idp_email_verified",
    "avatar_url",
    "email_public",
    "default_frequency_preset_id",
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
  readonly resourceChanges: AnyRow[] = [];

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
    if (sql.includes("FROM simulations t LEFT JOIN simulation_roles")) {
      const id = String(bound[1] ?? "");
      return this.simulations.get(id) ?? null;
    }
    if (sql.includes("FROM sites t LEFT JOIN site_roles")) {
      const id = String(bound[1] ?? "");
      return this.sites.get(id) ?? null;
    }
    if (sql.includes("SELECT id FROM simulations WHERE lower(name) = lower(?)")) {
      const name = String(bound[0] ?? "").trim().toLowerCase();
      const id = String(bound[1] ?? "");
      for (const row of this.simulations.values()) {
        if (String(row.name ?? "").trim().toLowerCase() === name && row.id !== id) {
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
    return null;
  }

  all(sql: string): AnyRow[] {
    const pragmaMatch = sql.match(/^PRAGMA table_info\(([^)]+)\)$/i);
    if (pragmaMatch) {
      const table = pragmaMatch[1] ?? "";
      return (TABLE_COLUMNS[table] ?? []).map((name) => ({ name }));
    }
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

  afterEach(() => {
    vi.useRealTimers();
  });
});
