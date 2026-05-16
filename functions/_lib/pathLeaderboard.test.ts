import { beforeEach, describe, expect, it } from "vitest";
import { listStatsPathLeaderboardEntries, submitPathLeaderboardCandidate } from "./pathLeaderboard";
import type { DbVisibility, Env } from "./types";

type SimulationRow = {
  id: string;
  owner_user_id: string;
  name: string;
  visibility: DbVisibility;
  payload_json: string;
};

type UserRow = {
  id: string;
  username: string;
  avatar_url: string;
};

type EntryRow = {
  simulation_id: string;
  canonical_path_key: string;
  owner_user_id: string;
  from_site_id: string;
  to_site_id: string;
  link_id: string | null;
  path_label: string;
  simulation_name: string;
  distance_km: number;
  rx_after_env_loss_dbm: number;
  rx_margin_db: number;
  terrain_obstructed: number;
  terrain_dataset: string;
  terrain_tile_signature: string;
  simulation_updated_at: string;
  created_at: string;
  updated_at: string;
};

class Statement {
  private values: unknown[] = [];

  constructor(private readonly db: FakeDb, private readonly sql: string) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    this.db.run(this.sql, this.values);
    return { success: true };
  }

  async first<T>() {
    return this.db.first(this.sql, this.values) as T | null;
  }

  async all<T>() {
    return { results: this.db.all(this.sql, this.values) as T[] };
  }
}

class FakeDb {
  readonly users = new Map<string, UserRow>();
  readonly simulations = new Map<string, SimulationRow>();
  readonly entries = new Map<string, EntryRow>();

  prepare(sql: string) {
    return new Statement(this, sql);
  }

  run(sql: string, values: unknown[]) {
    if (!sql.includes("simulation_path_leaderboard_entries")) return;
    if (sql.trim().startsWith("INSERT INTO simulation_path_leaderboard_entries")) {
      const [
        simulationId,
        canonicalPathKey,
        ownerUserId,
        fromSiteId,
        toSiteId,
        linkId,
        pathLabel,
        simulationName,
        distanceKm,
        rxAfterEnvLossDbm,
        rxMarginDb,
        terrainObstructed,
        terrainDataset,
        terrainTileSignature,
        simulationUpdatedAt,
        createdAt,
        updatedAt,
      ] = values;
      const key = `${simulationId}:${canonicalPathKey}`;
      const existing = this.entries.get(key);
      if (
        existing &&
        existing.simulation_updated_at === simulationUpdatedAt &&
        existing.distance_km >= Number(distanceKm)
      ) {
        return;
      }
      this.entries.set(key, {
        simulation_id: String(simulationId),
        canonical_path_key: String(canonicalPathKey),
        owner_user_id: String(ownerUserId),
        from_site_id: String(fromSiteId),
        to_site_id: String(toSiteId),
        link_id: linkId === null ? null : String(linkId),
        path_label: String(pathLabel),
        simulation_name: String(simulationName),
        distance_km: Number(distanceKm),
        rx_after_env_loss_dbm: Number(rxAfterEnvLossDbm),
        rx_margin_db: Number(rxMarginDb),
        terrain_obstructed: Number(terrainObstructed),
        terrain_dataset: String(terrainDataset),
        terrain_tile_signature: String(terrainTileSignature),
        simulation_updated_at: String(simulationUpdatedAt),
        created_at: String(createdAt),
        updated_at: String(updatedAt),
      });
      return;
    }
    if (sql.trim().startsWith("DELETE FROM simulation_path_leaderboard_entries")) {
      const keep = Number(values[0] ?? 5);
      const visible = this.visibleEntries().slice(0, keep);
      const keepKeys = new Set(visible.map((entry) => `${entry.simulation_id}:${entry.canonical_path_key}`));
      for (const key of this.entries.keys()) {
        if (!keepKeys.has(key)) this.entries.delete(key);
      }
    }
  }

  first(sql: string, values: unknown[]) {
    if (sql.includes("FROM simulations s") && sql.includes("WHERE s.id = ?")) {
      const actorId = String(values[0]);
      const simulationId = String(values[1]);
      const row = this.simulations.get(simulationId);
      if (!row) return null;
      return { ...row, actor_role: row.owner_user_id === actorId ? "owner" : null };
    }
    return null;
  }

  all(sql: string, values: unknown[]) {
    if (sql.includes("FROM simulation_path_leaderboard_entries")) {
      return this.visibleEntries().slice(0, Number(values[0] ?? 5)).map((entry) => {
        const simulation = this.simulations.get(entry.simulation_id)!;
        const user = this.users.get(entry.owner_user_id);
        return {
          ...entry,
          username: user?.username ?? null,
          avatar_url: user?.avatar_url ?? null,
          simulation_payload_json: simulation.payload_json,
          simulation_db_name: simulation.name,
        };
      });
    }
    return [];
  }

  private visibleEntries() {
    return [...this.entries.values()]
      .filter((entry) => {
        const simulation = this.simulations.get(entry.simulation_id);
        if (!simulation || simulation.visibility === "private") return false;
        const payload = JSON.parse(simulation.payload_json) as { updatedAt?: string };
        return payload.updatedAt === entry.simulation_updated_at;
      })
      .sort((a, b) => b.distance_km - a.distance_km || a.path_label.localeCompare(b.path_label));
  }
}

const mkPayload = (input?: {
  id?: string;
  name?: string;
  updatedAt?: string;
  fromId?: string;
  toId?: string;
  linkId?: string;
}) => ({
  id: input?.id ?? "sim-1",
  name: input?.name ?? "Public sim",
  slug: input?.name ?? "Public-sim",
  updatedAt: input?.updatedAt ?? "2026-05-16T12:00:00.000Z",
  snapshot: {
    sites: [
      { id: input?.fromId ?? "site-a", name: "Alpha" },
      { id: input?.toId ?? "site-b", name: "Beta" },
    ],
    links: [
      {
        id: input?.linkId ?? "link-1",
        fromSiteId: input?.fromId ?? "site-a",
        toSiteId: input?.toId ?? "site-b",
      },
    ],
  },
});

const baseCandidate = () => ({
  simulationId: "sim-1",
  simulationUpdatedAt: "2026-05-16T12:00:00.000Z",
  fromSiteId: "site-a",
  toSiteId: "site-b",
  linkId: "link-1",
  distanceKm: 42,
  rxAfterEnvLossDbm: -101,
  rxMarginDb: 19,
  terrainObstructed: true,
  terrainDataset: "copernicus30",
  terrainTileSignature: "terrain-hash",
});

const actor = { id: "u1", isAdmin: false, isModerator: false };
let fakeDb: FakeDb;
let env: Env;

beforeEach(() => {
  fakeDb = new FakeDb();
  fakeDb.users.set("u1", { id: "u1", username: "Ada", avatar_url: "" });
  fakeDb.simulations.set("sim-1", {
    id: "sim-1",
    owner_user_id: "u1",
    name: "Public sim",
    visibility: "public_read",
    payload_json: JSON.stringify(mkPayload()),
  });
  env = { DB: fakeDb as unknown as D1Database };
});

describe("path leaderboard storage", () => {
  it("stores and lists a public terrain-backed passing path", async () => {
    await expect(submitPathLeaderboardCandidate(env, actor, baseCandidate())).resolves.toMatchObject({
      ok: true,
      stored: true,
    });

    await expect(listStatsPathLeaderboardEntries(env)).resolves.toEqual([
      expect.objectContaining({
        label: "Alpha ~ Beta",
        href: "/Ada/Public-sim/Alpha~Beta",
        distanceKm: 42,
        rxMarginDb: 19,
        terrainObstructed: true,
      }),
    ]);
  });

  it("dedupes reversed endpoints under one canonical path and keeps the longer distance", async () => {
    await submitPathLeaderboardCandidate(env, actor, baseCandidate());
    await submitPathLeaderboardCandidate(env, actor, {
      ...baseCandidate(),
      fromSiteId: "site-b",
      toSiteId: "site-a",
      distanceKm: 50,
      linkId: "link-1",
    });

    expect(fakeDb.entries.size).toBe(1);
    const [entry] = await listStatsPathLeaderboardEntries(env);
    expect(entry.distanceKm).toBe(50);
    expect(entry.label).toBe("Beta ~ Alpha");
  });

  it("rejects stale and non-passing candidates", async () => {
    await expect(
      submitPathLeaderboardCandidate(env, actor, { ...baseCandidate(), simulationUpdatedAt: "old" }),
    ).resolves.toMatchObject({ ok: false, reason: "stale_simulation" });
    await expect(
      submitPathLeaderboardCandidate(env, actor, { ...baseCandidate(), rxMarginDb: -0.1 }),
    ).resolves.toMatchObject({ ok: false, reason: "not_passing" });
  });

  it("does not store private simulations for the public leaderboard", async () => {
    fakeDb.simulations.get("sim-1")!.visibility = "private";
    await expect(submitPathLeaderboardCandidate(env, actor, baseCandidate())).resolves.toMatchObject({
      ok: true,
      stored: false,
      reason: "private_simulation",
    });
    await expect(listStatsPathLeaderboardEntries(env)).resolves.toEqual([]);
  });

  it("keeps only the top five visible entries", async () => {
    for (let index = 0; index < 6; index += 1) {
      const simulationId = `sim-${index}`;
      fakeDb.simulations.set(simulationId, {
        id: simulationId,
        owner_user_id: "u1",
        name: `Public sim ${index}`,
        visibility: "public_read",
        payload_json: JSON.stringify(
          mkPayload({
            id: simulationId,
            name: `Public sim ${index}`,
            fromId: `from-${index}`,
            toId: `to-${index}`,
            linkId: `link-${index}`,
          }),
        ),
      });
      await submitPathLeaderboardCandidate(env, actor, {
        ...baseCandidate(),
        simulationId,
        fromSiteId: `from-${index}`,
        toSiteId: `to-${index}`,
        linkId: `link-${index}`,
        distanceKm: index + 1,
      });
    }

    const entries = await listStatsPathLeaderboardEntries(env);
    expect(entries).toHaveLength(5);
    expect(entries.map((entry) => entry.distanceKm)).toEqual([6, 5, 4, 3, 2]);
  });
});
