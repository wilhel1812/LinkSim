import type { CloudResourceRecord, Env, Grant, ResourceRole, Visibility } from "./types";

const VISIBILITIES: Visibility[] = ["private", "public_read", "public_write"];
const ROLES: ResourceRole[] = ["viewer", "editor", "admin"];

const sanitizeVisibility = (value: unknown): Visibility =>
  typeof value === "string" && VISIBILITIES.includes(value as Visibility)
    ? (value as Visibility)
    : "private";

const sanitizeRole = (value: unknown): ResourceRole | null =>
  typeof value === "string" && ROLES.includes(value as ResourceRole) ? (value as ResourceRole) : null;

const sanitizeGrants = (value: unknown): Grant[] => {
  if (!Array.isArray(value)) return [];
  const dedup = new Map<string, Grant>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const userId = typeof (item as { userId?: unknown }).userId === "string" ? (item as { userId: string }).userId.trim() : "";
    const role = sanitizeRole((item as { role?: unknown }).role);
    if (!userId || !role) continue;
    dedup.set(userId, { userId, role });
  }
  return Array.from(dedup.values());
};

export const ensureUser = async (env: Env, userId: string): Promise<void> => {
  await env.DB.prepare("INSERT OR IGNORE INTO users (id, created_at) VALUES (?, ?)")
    .bind(userId, new Date().toISOString())
    .run();
};

const upsertOwnedResource = async (
  env: Env,
  kind: "site" | "simulation",
  ownerId: string,
  item: CloudResourceRecord,
): Promise<{ ok: boolean; reason?: string }> => {
  const table = kind === "site" ? "sites" : "simulations";
  const rolesTable = kind === "site" ? "site_roles" : "simulation_roles";

  const id = typeof item.id === "string" ? item.id.trim() : "";
  const name = typeof item.name === "string" ? item.name.trim() : "";
  if (!id || !name) return { ok: false, reason: `invalid_${kind}` };

  const visibility = sanitizeVisibility(item.visibility);
  const sharedWith = sanitizeGrants(item.sharedWith);
  const payload = JSON.stringify({ ...item, visibility, sharedWith });
  const updatedAt = new Date().toISOString();

  const existing = await env.DB.prepare(`SELECT owner_user_id FROM ${table} WHERE id = ?`).bind(id).first<{
    owner_user_id: string;
  }>();

  if (existing && existing.owner_user_id !== ownerId) {
    return { ok: false, reason: `not_owner_${kind}` };
  }

  await env.DB.prepare(
    `INSERT INTO ${table} (id, owner_user_id, name, visibility, payload_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       visibility = excluded.visibility,
       payload_json = excluded.payload_json,
       updated_at = excluded.updated_at`,
  )
    .bind(id, ownerId, name, visibility, payload, updatedAt)
    .run();

  await env.DB.prepare(`DELETE FROM ${rolesTable} WHERE ${kind}_id = ?`).bind(id).run();
  if (sharedWith.length) {
    const now = new Date().toISOString();
    const statements = sharedWith
      .filter((grant) => grant.userId !== ownerId)
      .map((grant) =>
        env.DB.prepare(
          `INSERT INTO ${rolesTable} (${kind}_id, user_id, role, created_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(${kind}_id, user_id) DO UPDATE SET role = excluded.role`,
        ).bind(id, grant.userId, grant.role, now),
      );
    if (statements.length) {
      await env.DB.batch(statements);
    }
  }

  return { ok: true };
};

export const upsertLibrarySnapshot = async (
  env: Env,
  ownerId: string,
  payload: { siteLibrary: CloudResourceRecord[]; simulationPresets: CloudResourceRecord[] },
): Promise<{ upsertedSites: number; upsertedSimulations: number; conflicts: string[] }> => {
  const conflicts: string[] = [];
  let upsertedSites = 0;
  let upsertedSimulations = 0;

  for (const site of payload.siteLibrary.slice(0, 4000)) {
    const result = await upsertOwnedResource(env, "site", ownerId, site);
    if (result.ok) upsertedSites += 1;
    else if (result.reason) conflicts.push(result.reason);
  }

  for (const simulation of payload.simulationPresets.slice(0, 4000)) {
    const result = await upsertOwnedResource(env, "simulation", ownerId, simulation);
    if (result.ok) upsertedSimulations += 1;
    else if (result.reason) conflicts.push(result.reason);
  }

  return { upsertedSites, upsertedSimulations, conflicts };
};

const canEditByRole = (role: string | null, visibility: Visibility): boolean =>
  role === "admin" || role === "editor" || visibility === "public_write";

export const fetchLibraryForUser = async (
  env: Env,
  userId: string,
): Promise<{ siteLibrary: CloudResourceRecord[]; simulationPresets: CloudResourceRecord[] }> => {
  const siteRows = await env.DB.prepare(
    `SELECT s.payload_json, s.owner_user_id, s.visibility, r.role
     FROM sites s
     LEFT JOIN site_roles r ON r.site_id = s.id AND r.user_id = ?
     WHERE s.owner_user_id = ? OR r.user_id IS NOT NULL OR s.visibility IN ('public_read', 'public_write')`,
  )
    .bind(userId, userId)
    .all<{ payload_json: string; owner_user_id: string; visibility: Visibility; role: string | null }>();

  const simulationRows = await env.DB.prepare(
    `SELECT s.payload_json, s.owner_user_id, s.visibility, r.role
     FROM simulations s
     LEFT JOIN simulation_roles r ON r.simulation_id = s.id AND r.user_id = ?
     WHERE s.owner_user_id = ? OR r.user_id IS NOT NULL OR s.visibility IN ('public_read', 'public_write')`,
  )
    .bind(userId, userId)
    .all<{ payload_json: string; owner_user_id: string; visibility: Visibility; role: string | null }>();

  const siteLibrary = siteRows.results
    .map((row) => {
      try {
        const parsed = JSON.parse(row.payload_json) as CloudResourceRecord;
        return {
          ...parsed,
          ownerUserId: row.owner_user_id,
          visibility: row.visibility,
          effectiveRole: row.owner_user_id === userId ? "owner" : row.role ?? (canEditByRole(null, row.visibility) ? "editor" : "viewer"),
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is CloudResourceRecord => item !== null);

  const simulationPresets = simulationRows.results
    .map((row) => {
      try {
        const parsed = JSON.parse(row.payload_json) as CloudResourceRecord;
        return {
          ...parsed,
          ownerUserId: row.owner_user_id,
          visibility: row.visibility,
          effectiveRole: row.owner_user_id === userId ? "owner" : row.role ?? (canEditByRole(null, row.visibility) ? "editor" : "viewer"),
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is CloudResourceRecord => item !== null);

  return { siteLibrary, simulationPresets };
};
