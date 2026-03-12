import type { CloudResourceRecord, Env, Grant, ResourceRole, Visibility } from "./types";

const VISIBILITIES: Visibility[] = ["private", "public_read", "public_write"];
const ROLES: ResourceRole[] = ["viewer", "editor", "admin"];

let schemaReady: Promise<void> | null = null;

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

const sanitizeUsername = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const username = value.trim().replace(/\s+/g, " ");
  if (username.length < 2 || username.length > 48) return null;
  return username;
};

const deriveDefaultUsername = (userId: string, tokenPayload?: Record<string, unknown>): string => {
  const fromName = sanitizeUsername(tokenPayload?.name);
  if (fromName) return fromName;
  const fromEmail = sanitizeUsername(tokenPayload?.email);
  if (fromEmail) return fromEmail;
  const prefix = userId.includes("@") ? userId.split("@")[0] : userId;
  const compact = prefix.replace(/[_-]+/g, " ");
  return sanitizeUsername(compact) ?? "User";
};

const parseAdminUserIds = (env: Env): Set<string> => {
  const raw = env.ADMIN_USER_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
};

const ensureSchema = async (env: Env): Promise<void> => {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch([
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT
          )`,
        ),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS sites (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public_read', 'public_write')),
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
          )`,
        ),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS site_roles (
            site_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
            created_at TEXT NOT NULL,
            PRIMARY KEY (site_id, user_id),
            FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )`,
        ),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS simulations (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            name TEXT NOT NULL,
            visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public_read', 'public_write')),
            payload_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
          )`,
        ),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS simulation_roles (
            simulation_id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'admin')),
            created_at TEXT NOT NULL,
            PRIMARY KEY (simulation_id, user_id),
            FOREIGN KEY (simulation_id) REFERENCES simulations(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )`,
        ),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sites_owner ON sites(owner_user_id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sites_visibility ON sites(visibility)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_site_roles_user ON site_roles(user_id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_simulations_owner ON simulations(owner_user_id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_simulations_visibility ON simulations(visibility)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_simulation_roles_user ON simulation_roles(user_id)"),
      ]);

      const userColumns = await env.DB.prepare("PRAGMA table_info(users)").all<{ name: string }>();
      const names = new Set(userColumns.results.map((col) => col.name));

      if (!names.has("username")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN username TEXT").run();
      }
      if (!names.has("is_admin")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0").run();
      }
      if (!names.has("updated_at")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN updated_at TEXT").run();
      }
    })();
  }
  await schemaReady;
};

type UserRow = {
  id: string;
  username: string | null;
  is_admin: number;
  created_at: string;
  updated_at: string | null;
};

const toUserProfile = (row: UserRow) => ({
  id: row.id,
  username: row.username && row.username.trim() ? row.username : row.id,
  isAdmin: row.is_admin === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const ensureUser = async (
  env: Env,
  userId: string,
  tokenPayload?: Record<string, unknown>,
): Promise<void> => {
  await ensureSchema(env);
  const now = new Date().toISOString();
  const username = deriveDefaultUsername(userId, tokenPayload);
  const isBootstrapAdmin = parseAdminUserIds(env).has(userId.toLowerCase()) ? 1 : 0;

  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, username, is_admin, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(userId, username, isBootstrapAdmin, now, now)
    .run();

  await env.DB.prepare(
    `UPDATE users
     SET username = COALESCE(NULLIF(TRIM(username), ''), ?),
         is_admin = CASE WHEN ? = 1 THEN 1 ELSE is_admin END,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(username, isBootstrapAdmin, now, userId)
    .run();
};

export const fetchUserProfile = async (env: Env, userId: string) => {
  await ensureSchema(env);
  const row = await env.DB.prepare(
    "SELECT id, username, is_admin, created_at, updated_at FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<UserRow>();
  return row ? toUserProfile(row) : null;
};

export const updateOwnUsername = async (env: Env, userId: string, usernameRaw: unknown) => {
  await ensureSchema(env);
  const username = sanitizeUsername(usernameRaw);
  if (!username) {
    throw new Error("Username must be between 2 and 48 characters.");
  }
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE users SET username = ?, updated_at = ? WHERE id = ?")
    .bind(username, now, userId)
    .run();
  const profile = await fetchUserProfile(env, userId);
  if (!profile) throw new Error("User not found after update.");
  return profile;
};

export const listUsers = async (env: Env) => {
  await ensureSchema(env);
  const rows = await env.DB.prepare(
    "SELECT id, username, is_admin, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT 2000",
  ).all<UserRow>();
  return rows.results.map(toUserProfile);
};

export const setUserAdminFlag = async (env: Env, userId: string, isAdminRaw: unknown) => {
  await ensureSchema(env);
  const isAdmin = Boolean(isAdminRaw);
  await env.DB.prepare("UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?")
    .bind(isAdmin ? 1 : 0, new Date().toISOString(), userId)
    .run();
  const profile = await fetchUserProfile(env, userId);
  if (!profile) throw new Error("User not found.");
  return profile;
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
  await ensureSchema(env);
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
  await ensureSchema(env);
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
          effectiveRole:
            row.owner_user_id === userId
              ? "owner"
              : row.role ?? (canEditByRole(null, row.visibility) ? "editor" : "viewer"),
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
          effectiveRole:
            row.owner_user_id === userId
              ? "owner"
              : row.role ?? (canEditByRole(null, row.visibility) ? "editor" : "viewer"),
        };
      } catch {
        return null;
      }
    })
    .filter((item): item is CloudResourceRecord => item !== null);

  return { siteLibrary, simulationPresets };
};
