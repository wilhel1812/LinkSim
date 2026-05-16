import type { DbVisibility, Env } from "./types";

type ActorPolicy = {
  id: string;
  isAdmin: boolean;
  isModerator: boolean;
};

export type PathLeaderboardCandidate = {
  simulationId: string;
  simulationUpdatedAt: string;
  fromSiteId: string;
  toSiteId: string;
  linkId?: string | null;
  distanceKm: number;
  rxAfterEnvLossDbm: number;
  rxMarginDb: number;
  terrainObstructed: boolean;
  terrainDataset: string;
  terrainTileSignature: string;
};

export type PathLeaderboardSubmitResult = {
  ok: boolean;
  stored: boolean;
  reason?: string;
};

export type StatsPathLeaderboardEntry = {
  id: string;
  label: string;
  href: string;
  simulationHref: string;
  simulationName: string;
  distanceKm: number;
  rxAfterEnvLossDbm: number;
  rxMarginDb: number;
  terrainObstructed: boolean;
  owner: {
    userId: string;
    username: string;
    avatarUrl: string;
  };
};

type SimulationRow = {
  id: string;
  owner_user_id: string;
  name: string;
  visibility: DbVisibility;
  payload_json: string;
  actor_role?: string | null;
};

type SnapshotSite = {
  id?: unknown;
  name?: unknown;
};

type SnapshotLink = {
  id?: unknown;
  name?: unknown;
  fromSiteId?: unknown;
  toSiteId?: unknown;
};

type SimulationPayload = {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  updatedAt?: unknown;
  snapshot?: {
    sites?: unknown;
    links?: unknown;
  };
};

type LeaderboardRow = {
  simulation_id: string;
  canonical_path_key: string;
  from_site_id: string;
  to_site_id: string;
  link_id: string | null;
  path_label: string;
  simulation_name: string;
  distance_km: number;
  rx_after_env_loss_dbm: number;
  rx_margin_db: number;
  terrain_obstructed: number;
  owner_user_id: string;
  username: string | null;
  avatar_url: string | null;
  simulation_payload_json: string;
  simulation_db_name: string | null;
};

const MAX_DISPLAY_ENTRIES = 5;

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const normalizeId = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const normalizeText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const parseJsonObject = <T>(raw: string): T | null => {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
};

const snapshotSites = (payload: SimulationPayload | null): SnapshotSite[] =>
  Array.isArray(payload?.snapshot?.sites) ? (payload.snapshot.sites as SnapshotSite[]) : [];

const snapshotLinks = (payload: SimulationPayload | null): SnapshotLink[] =>
  Array.isArray(payload?.snapshot?.links) ? (payload.snapshot.links as SnapshotLink[]) : [];

const canonicalPathKey = (fromSiteId: string, toSiteId: string): string =>
  [fromSiteId, toSiteId].sort((a, b) => a.localeCompare(b)).join("~");

const canReadSimulation = (actor: ActorPolicy, row: SimulationRow): boolean => {
  if (actor.isAdmin) return true;
  if (row.owner_user_id === actor.id) return true;
  if (typeof row.actor_role === "string" && row.actor_role.trim()) return true;
  return row.visibility === "public_read" || row.visibility === "public_write";
};

const slugifySegment = (value: string): string =>
  value
    .trim()
    .normalize("NFKC")
    .replace(/[\uFE0E\uFE0F]/g, "")
    .replace(/[+<>~/]/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const hrefForSimulation = (
  ownerUsername: string | null | undefined,
  simulationId: string,
  dbName: string | null | undefined,
  payload: SimulationPayload | null,
): string => {
  const username = slugifySegment(ownerUsername?.trim() || "");
  const name = typeof payload?.slug === "string" && payload.slug.trim()
    ? payload.slug
    : typeof payload?.name === "string" && payload.name.trim()
      ? payload.name
      : dbName ?? "";
  const simulationSlug = slugifySegment(name);
  if (username && simulationSlug) return `/${username}/${simulationSlug}`;
  return `/?sim=${encodeURIComponent(simulationId)}`;
};

const hrefForPath = (
  simulationHref: string,
  fromSite: SnapshotSite | undefined,
  toSite: SnapshotSite | undefined,
): string => {
  const fromName = typeof fromSite?.name === "string" ? slugifySegment(fromSite.name) : "";
  const toName = typeof toSite?.name === "string" ? slugifySegment(toSite.name) : "";
  if (!fromName || !toName || simulationHref.startsWith("/?")) return simulationHref;
  return `${simulationHref}/${fromName}~${toName}`;
};

export const ensurePathLeaderboardSchema = async (env: Env): Promise<void> => {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS simulation_path_leaderboard_entries (
      simulation_id TEXT NOT NULL,
      canonical_path_key TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      from_site_id TEXT NOT NULL,
      to_site_id TEXT NOT NULL,
      link_id TEXT,
      path_label TEXT NOT NULL,
      simulation_name TEXT NOT NULL,
      distance_km REAL NOT NULL,
      rx_after_env_loss_dbm REAL NOT NULL,
      rx_margin_db REAL NOT NULL,
      terrain_obstructed INTEGER NOT NULL DEFAULT 0,
      terrain_dataset TEXT NOT NULL,
      terrain_tile_signature TEXT NOT NULL,
      simulation_updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (simulation_id, canonical_path_key)
    )`,
  ).run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_path_leaderboard_distance ON simulation_path_leaderboard_entries(distance_km DESC)").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_path_leaderboard_simulation ON simulation_path_leaderboard_entries(simulation_id)").run();
};

const validateCandidate = (candidate: PathLeaderboardCandidate): { ok: true } | { ok: false; reason: string } => {
  if (!normalizeId(candidate.simulationId)) return { ok: false, reason: "missing_simulation" };
  if (!normalizeId(candidate.fromSiteId) || !normalizeId(candidate.toSiteId)) return { ok: false, reason: "missing_endpoint" };
  if (candidate.fromSiteId === candidate.toSiteId) return { ok: false, reason: "same_endpoint" };
  if (!normalizeText(candidate.simulationUpdatedAt)) return { ok: false, reason: "missing_revision" };
  if (!isFiniteNumber(candidate.distanceKm) || candidate.distanceKm <= 0) return { ok: false, reason: "invalid_distance" };
  if (!isFiniteNumber(candidate.rxAfterEnvLossDbm)) return { ok: false, reason: "invalid_rx" };
  if (!isFiniteNumber(candidate.rxMarginDb)) return { ok: false, reason: "invalid_margin" };
  if (candidate.rxMarginDb < 0) return { ok: false, reason: "not_passing" };
  if (!normalizeText(candidate.terrainDataset)) return { ok: false, reason: "missing_terrain_dataset" };
  if (!normalizeText(candidate.terrainTileSignature)) return { ok: false, reason: "missing_terrain_signature" };
  return { ok: true };
};

export const submitPathLeaderboardCandidate = async (
  env: Env,
  actor: ActorPolicy,
  rawCandidate: PathLeaderboardCandidate,
): Promise<PathLeaderboardSubmitResult> => {
  await ensurePathLeaderboardSchema(env);
  const validation = validateCandidate(rawCandidate);
  if (!validation.ok) return { ok: false, stored: false, reason: validation.reason };

  const candidate = {
    ...rawCandidate,
    simulationId: normalizeId(rawCandidate.simulationId),
    fromSiteId: normalizeId(rawCandidate.fromSiteId),
    toSiteId: normalizeId(rawCandidate.toSiteId),
    linkId: normalizeId(rawCandidate.linkId) || null,
    simulationUpdatedAt: normalizeText(rawCandidate.simulationUpdatedAt),
    terrainDataset: normalizeText(rawCandidate.terrainDataset),
    terrainTileSignature: normalizeText(rawCandidate.terrainTileSignature),
  };

  const row = await env.DB
    .prepare(
      `SELECT s.id, s.owner_user_id, s.name, s.visibility, s.payload_json, r.role AS actor_role
       FROM simulations s
       LEFT JOIN simulation_roles r ON r.simulation_id = s.id AND r.user_id = ?
       WHERE s.id = ?
       LIMIT 1`,
    )
    .bind(actor.id, candidate.simulationId)
    .first<SimulationRow>();
  if (!row) return { ok: false, stored: false, reason: "missing_simulation" };
  if (!canReadSimulation(actor, row)) return { ok: false, stored: false, reason: "forbidden_simulation" };
  if (row.visibility === "private") return { ok: true, stored: false, reason: "private_simulation" };

  const payload = parseJsonObject<SimulationPayload>(row.payload_json);
  const payloadUpdatedAt = normalizeText(payload?.updatedAt);
  if (!payloadUpdatedAt || payloadUpdatedAt !== candidate.simulationUpdatedAt) {
    return { ok: false, stored: false, reason: "stale_simulation" };
  }

  const sites = snapshotSites(payload);
  const fromSite = sites.find((site) => site.id === candidate.fromSiteId);
  const toSite = sites.find((site) => site.id === candidate.toSiteId);
  if (!fromSite || !toSite) return { ok: false, stored: false, reason: "missing_endpoint" };

  if (candidate.linkId) {
    const link = snapshotLinks(payload).find((entry) => entry.id === candidate.linkId);
    if (!link) return { ok: false, stored: false, reason: "missing_link" };
    const endpoints = canonicalPathKey(candidate.fromSiteId, candidate.toSiteId);
    const linkEndpoints = canonicalPathKey(normalizeId(link.fromSiteId), normalizeId(link.toSiteId));
    if (endpoints !== linkEndpoints) return { ok: false, stored: false, reason: "link_endpoint_mismatch" };
  }

  const fromName = normalizeText(fromSite.name) || "Site A";
  const toName = normalizeText(toSite.name) || "Site B";
  const label = `${fromName} ~ ${toName}`;
  const simulationName = normalizeText(payload?.name) || row.name || "Untitled Simulation";
  const key = canonicalPathKey(candidate.fromSiteId, candidate.toSiteId);
  const now = new Date().toISOString();

  await env.DB
    .prepare(
      `INSERT INTO simulation_path_leaderboard_entries
       (simulation_id, canonical_path_key, owner_user_id, from_site_id, to_site_id, link_id, path_label, simulation_name,
        distance_km, rx_after_env_loss_dbm, rx_margin_db, terrain_obstructed, terrain_dataset, terrain_tile_signature,
        simulation_updated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(simulation_id, canonical_path_key) DO UPDATE SET
         owner_user_id = excluded.owner_user_id,
         from_site_id = excluded.from_site_id,
         to_site_id = excluded.to_site_id,
         link_id = excluded.link_id,
         path_label = excluded.path_label,
         simulation_name = excluded.simulation_name,
         distance_km = excluded.distance_km,
         rx_after_env_loss_dbm = excluded.rx_after_env_loss_dbm,
         rx_margin_db = excluded.rx_margin_db,
         terrain_obstructed = excluded.terrain_obstructed,
         terrain_dataset = excluded.terrain_dataset,
         terrain_tile_signature = excluded.terrain_tile_signature,
         simulation_updated_at = excluded.simulation_updated_at,
         updated_at = excluded.updated_at
       WHERE simulation_path_leaderboard_entries.simulation_updated_at != excluded.simulation_updated_at
          OR excluded.distance_km > simulation_path_leaderboard_entries.distance_km`,
    )
    .bind(
      candidate.simulationId,
      key,
      row.owner_user_id,
      candidate.fromSiteId,
      candidate.toSiteId,
      candidate.linkId,
      label,
      simulationName,
      Math.round(candidate.distanceKm * 10) / 10,
      Math.round(candidate.rxAfterEnvLossDbm * 10) / 10,
      Math.round(candidate.rxMarginDb * 10) / 10,
      candidate.terrainObstructed ? 1 : 0,
      candidate.terrainDataset,
      candidate.terrainTileSignature,
      candidate.simulationUpdatedAt,
      now,
      now,
    )
    .run();

  await env.DB
    .prepare(
      `DELETE FROM simulation_path_leaderboard_entries
       WHERE rowid NOT IN (
         SELECT e.rowid
         FROM simulation_path_leaderboard_entries e
         JOIN simulations s ON s.id = e.simulation_id
         WHERE s.visibility IN ('public_read', 'public_write')
           AND json_extract(s.payload_json, '$.updatedAt') = e.simulation_updated_at
         ORDER BY e.distance_km DESC, e.path_label ASC
         LIMIT ?
       )`,
    )
    .bind(MAX_DISPLAY_ENTRIES)
    .run();

  return { ok: true, stored: true };
};

export const listStatsPathLeaderboardEntries = async (env: Env): Promise<StatsPathLeaderboardEntry[]> => {
  await ensurePathLeaderboardSchema(env);
  const rows = await env.DB
    .prepare(
      `SELECT e.simulation_id, e.canonical_path_key, e.from_site_id, e.to_site_id, e.link_id, e.path_label, e.simulation_name,
              e.distance_km, e.rx_after_env_loss_dbm, e.rx_margin_db, e.terrain_obstructed, e.owner_user_id,
              u.username, u.avatar_url, s.payload_json AS simulation_payload_json, s.name AS simulation_db_name
       FROM simulation_path_leaderboard_entries e
       JOIN simulations s ON s.id = e.simulation_id
       LEFT JOIN users u ON u.id = e.owner_user_id
       WHERE s.visibility IN ('public_read', 'public_write')
         AND json_extract(s.payload_json, '$.updatedAt') = e.simulation_updated_at
       ORDER BY e.distance_km DESC, e.path_label ASC
       LIMIT ?`,
    )
    .bind(MAX_DISPLAY_ENTRIES)
    .all<LeaderboardRow>();

  return (rows.results ?? []).map((row) => {
    const payload = parseJsonObject<SimulationPayload>(row.simulation_payload_json);
    const sites = snapshotSites(payload);
    const fromSite = sites.find((site) => site.id === row.from_site_id);
    const toSite = sites.find((site) => site.id === row.to_site_id);
    const simulationHref = hrefForSimulation(row.username, row.simulation_id, row.simulation_db_name, payload);
    return {
      id: `${row.simulation_id}:${row.canonical_path_key}`,
      label: row.path_label,
      href: hrefForPath(simulationHref, fromSite, toSite),
      simulationHref,
      simulationName: row.simulation_name,
      distanceKm: row.distance_km,
      rxAfterEnvLossDbm: row.rx_after_env_loss_dbm,
      rxMarginDb: row.rx_margin_db,
      terrainObstructed: row.terrain_obstructed === 1,
      owner: {
        userId: row.owner_user_id,
        username: row.username?.trim() || "Unknown user",
        avatarUrl: row.avatar_url ?? "",
      },
    };
  });
};
