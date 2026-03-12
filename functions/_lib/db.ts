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
    const userId =
      typeof (item as { userId?: unknown }).userId === "string"
        ? (item as { userId: string }).userId.trim()
        : "";
    const role = sanitizeRole((item as { role?: unknown }).role);
    if (!userId || !role) continue;
    dedup.set(userId, { userId, role });
  }
  return Array.from(dedup.values());
};

const sanitizeName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) return null;
  return name;
};

const sanitizeEmail = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 180) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
};

const sanitizeBio = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const bio = value.trim();
  return bio.length <= 300 ? bio : bio.slice(0, 300);
};

const sanitizeAccessRequestNote = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const note = value.trim();
  return note.length <= 1200 ? note : note.slice(0, 1200);
};

const sanitizeAvatar = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return "";
  if (raw.startsWith("data:image/")) {
    if (raw.length > 240_000) return null;
    if (!/^data:image\/(webp|png|jpeg|jpg);base64,/i.test(raw)) return null;
    return raw;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
};

const deriveDefaultName = (userId: string, tokenPayload?: Record<string, unknown>): string => {
  const fromName = sanitizeName(tokenPayload?.name);
  if (fromName) return fromName;
  const fromEmail = sanitizeEmail(tokenPayload?.email);
  if (fromEmail) return fromEmail.split("@")[0];
  const prefix = userId.includes("@") ? userId.split("@")[0] : userId;
  const compact = prefix.replace(/[_-]+/g, " ").trim();
  return sanitizeName(compact) ?? `User ${userId.slice(0, 6)}`;
};

const deriveDefaultEmail = (userId: string, tokenPayload?: Record<string, unknown>): string => {
  const fromEmail = sanitizeEmail(tokenPayload?.email);
  if (fromEmail) return fromEmail;
  const fromUserId = sanitizeEmail(userId);
  if (fromUserId) return fromUserId;
  return `${userId.slice(0, 12)}@users.linksim.local`;
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

const registrationMode = (env: Env): "open" | "approval_required" => {
  const value = (env.REGISTRATION_MODE ?? "approval_required").trim().toLowerCase();
  return value === "open" ? "open" : "approval_required";
};

const ensureSchema = async (env: Env): Promise<void> => {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch([
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT,
            email TEXT,
            bio TEXT,
            access_request_note TEXT,
            avatar_url TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0,
            is_approved INTEGER NOT NULL DEFAULT 0,
            approved_at TEXT,
            approved_by_user_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT
          )`,
        ),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS sites (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            created_by_user_id TEXT,
            last_edited_by_user_id TEXT,
            created_at TEXT,
            last_edited_at TEXT,
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
            created_by_user_id TEXT,
            last_edited_by_user_id TEXT,
            created_at TEXT,
            last_edited_at TEXT,
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
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS resource_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            resource_kind TEXT NOT NULL CHECK (resource_kind IN ('site','simulation')),
            resource_id TEXT NOT NULL,
            action TEXT NOT NULL CHECK (action IN ('created','updated')),
            actor_user_id TEXT NOT NULL,
            changed_at TEXT NOT NULL,
            note TEXT
          )`,
        ),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sites_owner ON sites(owner_user_id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sites_visibility ON sites(visibility)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_site_roles_user ON site_roles(user_id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_simulations_owner ON simulations(owner_user_id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_simulations_visibility ON simulations(visibility)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_simulation_roles_user ON simulation_roles(user_id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_resource_changes_lookup ON resource_changes(resource_kind, resource_id, changed_at DESC)"),
      ]);

      const userColumns = await env.DB.prepare("PRAGMA table_info(users)").all<{ name: string }>();
      const userNames = new Set(userColumns.results.map((col) => col.name));
      for (const query of [
        !userNames.has("username") ? "ALTER TABLE users ADD COLUMN username TEXT" : "",
        !userNames.has("email") ? "ALTER TABLE users ADD COLUMN email TEXT" : "",
        !userNames.has("bio") ? "ALTER TABLE users ADD COLUMN bio TEXT" : "",
        !userNames.has("access_request_note") ? "ALTER TABLE users ADD COLUMN access_request_note TEXT" : "",
        !userNames.has("avatar_url") ? "ALTER TABLE users ADD COLUMN avatar_url TEXT" : "",
        !userNames.has("is_admin") ? "ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0" : "",
        !userNames.has("is_approved") ? "ALTER TABLE users ADD COLUMN is_approved INTEGER NOT NULL DEFAULT 0" : "",
        !userNames.has("approved_at") ? "ALTER TABLE users ADD COLUMN approved_at TEXT" : "",
        !userNames.has("approved_by_user_id") ? "ALTER TABLE users ADD COLUMN approved_by_user_id TEXT" : "",
        !userNames.has("updated_at") ? "ALTER TABLE users ADD COLUMN updated_at TEXT" : "",
      ]) {
        if (query) await env.DB.prepare(query).run();
      }

      const siteColumns = await env.DB.prepare("PRAGMA table_info(sites)").all<{ name: string }>();
      const siteNames = new Set(siteColumns.results.map((col) => col.name));
      for (const query of [
        !siteNames.has("created_by_user_id") ? "ALTER TABLE sites ADD COLUMN created_by_user_id TEXT" : "",
        !siteNames.has("last_edited_by_user_id") ? "ALTER TABLE sites ADD COLUMN last_edited_by_user_id TEXT" : "",
        !siteNames.has("created_at") ? "ALTER TABLE sites ADD COLUMN created_at TEXT" : "",
        !siteNames.has("last_edited_at") ? "ALTER TABLE sites ADD COLUMN last_edited_at TEXT" : "",
      ]) {
        if (query) await env.DB.prepare(query).run();
      }

      const simColumns = await env.DB.prepare("PRAGMA table_info(simulations)").all<{ name: string }>();
      const simNames = new Set(simColumns.results.map((col) => col.name));
      for (const query of [
        !simNames.has("created_by_user_id") ? "ALTER TABLE simulations ADD COLUMN created_by_user_id TEXT" : "",
        !simNames.has("last_edited_by_user_id") ? "ALTER TABLE simulations ADD COLUMN last_edited_by_user_id TEXT" : "",
        !simNames.has("created_at") ? "ALTER TABLE simulations ADD COLUMN created_at TEXT" : "",
        !simNames.has("last_edited_at") ? "ALTER TABLE simulations ADD COLUMN last_edited_at TEXT" : "",
      ]) {
        if (query) await env.DB.prepare(query).run();
      }
    })();
  }
  await schemaReady;
};

type UserRow = {
  id: string;
  username: string | null;
  email: string | null;
  bio: string | null;
  access_request_note: string | null;
  avatar_url: string | null;
  is_admin: number;
  is_approved: number;
  approved_at: string | null;
  approved_by_user_id: string | null;
  created_at: string;
  updated_at: string | null;
};

const toUserProfile = (row: UserRow) => ({
  id: row.id,
  username: sanitizeName(row.username) ?? "User",
  email: sanitizeEmail(row.email) ?? "unknown@users.linksim.local",
  bio: row.bio ?? "",
  accessRequestNote: row.access_request_note ?? "",
  avatarUrl: row.avatar_url ?? "",
  isAdmin: row.is_admin === 1,
  isApproved: row.is_approved === 1,
  approvedAt: row.approved_at,
  approvedByUserId: row.approved_by_user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const readUserRow = async (env: Env, userId: string): Promise<UserRow | null> => {
  await ensureSchema(env);
  return env.DB
    .prepare(
      "SELECT id, username, email, bio, access_request_note, avatar_url, is_admin, is_approved, approved_at, approved_by_user_id, created_at, updated_at FROM users WHERE id = ?",
    )
    .bind(userId)
    .first<UserRow>();
};

const reconcileUserIdentityByEmail = async (env: Env, userId: string, email: string): Promise<void> => {
  const normalized = sanitizeEmail(email);
  if (!normalized) return;

  const existing = await env.DB
    .prepare(
      `SELECT id, username, email, bio, access_request_note, avatar_url, is_admin, is_approved, approved_at, approved_by_user_id, created_at, updated_at
       FROM users
       WHERE lower(email) = lower(?) AND id <> ?
       ORDER BY is_admin DESC, is_approved DESC, created_at ASC
       LIMIT 1`,
    )
    .bind(normalized, userId)
    .first<UserRow>();
  if (!existing) return;

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `UPDATE users
       SET is_admin = CASE WHEN ? = 1 THEN 1 ELSE is_admin END,
           is_approved = CASE WHEN ? = 1 THEN 1 ELSE is_approved END,
           approved_at = CASE WHEN ? = 1 THEN COALESCE(approved_at, ?) ELSE approved_at END,
           approved_by_user_id = CASE WHEN ? = 1 THEN COALESCE(approved_by_user_id, ?) ELSE approved_by_user_id END,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      existing.is_admin === 1 ? 1 : 0,
      existing.is_approved === 1 ? 1 : 0,
      existing.is_approved === 1 ? 1 : 0,
      existing.approved_at ?? now,
      existing.is_approved === 1 ? 1 : 0,
      existing.approved_by_user_id ?? existing.id,
      now,
      userId,
    )
    .run();

  await env.DB.batch([
    env.DB.prepare("UPDATE sites SET owner_user_id = ? WHERE owner_user_id = ?").bind(userId, existing.id),
    env.DB
      .prepare(
        `UPDATE sites
         SET created_by_user_id = CASE WHEN created_by_user_id = ? THEN ? ELSE created_by_user_id END,
             last_edited_by_user_id = CASE WHEN last_edited_by_user_id = ? THEN ? ELSE last_edited_by_user_id END`,
      )
      .bind(existing.id, userId, existing.id, userId),
    env.DB.prepare("UPDATE simulations SET owner_user_id = ? WHERE owner_user_id = ?").bind(userId, existing.id),
    env.DB
      .prepare(
        `UPDATE simulations
         SET created_by_user_id = CASE WHEN created_by_user_id = ? THEN ? ELSE created_by_user_id END,
             last_edited_by_user_id = CASE WHEN last_edited_by_user_id = ? THEN ? ELSE last_edited_by_user_id END`,
      )
      .bind(existing.id, userId, existing.id, userId),
    env.DB.prepare("UPDATE site_roles SET user_id = ? WHERE user_id = ?").bind(userId, existing.id),
    env.DB.prepare("UPDATE simulation_roles SET user_id = ? WHERE user_id = ?").bind(userId, existing.id),
    env.DB.prepare("UPDATE resource_changes SET actor_user_id = ? WHERE actor_user_id = ?").bind(userId, existing.id),
  ]);
};

export const ensureUser = async (
  env: Env,
  userId: string,
  tokenPayload?: Record<string, unknown>,
): Promise<void> => {
  await ensureSchema(env);
  const now = new Date().toISOString();
  const username = deriveDefaultName(userId, tokenPayload);
  const email = deriveDefaultEmail(userId, tokenPayload);
  const isBootstrapAdmin = parseAdminUserIds(env).has(userId.toLowerCase()) ? 1 : 0;
  const autoApprove = isBootstrapAdmin === 1 || registrationMode(env) === "open";

  await env.DB.prepare(
    `INSERT OR IGNORE INTO users
      (id, username, email, bio, access_request_note, avatar_url, is_admin, is_approved, approved_at, approved_by_user_id, created_at, updated_at)
     VALUES (?, ?, ?, '', '', '', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      userId,
      username,
      email,
      isBootstrapAdmin,
      autoApprove ? 1 : 0,
      autoApprove ? now : null,
      autoApprove ? userId : null,
      now,
      now,
    )
    .run();

  await env.DB.prepare(
    `UPDATE users
     SET username = COALESCE(NULLIF(TRIM(username), ''), ?),
         email = COALESCE(NULLIF(TRIM(email), ''), ?),
         is_admin = CASE WHEN ? = 1 THEN 1 ELSE is_admin END,
         is_approved = CASE WHEN ? = 1 THEN 1 ELSE is_approved END,
         approved_at = CASE WHEN ? = 1 AND approved_at IS NULL THEN ? ELSE approved_at END,
         approved_by_user_id = CASE WHEN ? = 1 AND approved_by_user_id IS NULL THEN ? ELSE approved_by_user_id END,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      username,
      email,
      isBootstrapAdmin,
      autoApprove ? 1 : 0,
      autoApprove ? 1 : 0,
      now,
      autoApprove ? 1 : 0,
      userId,
      now,
      userId,
    )
    .run();

  await reconcileUserIdentityByEmail(env, userId, email);
};

export const fetchUserProfile = async (env: Env, userId: string) => {
  const row = await readUserRow(env, userId);
  return row ? toUserProfile(row) : null;
};

export const assertUserAccess = async (env: Env, userId: string) => {
  const user = await fetchUserProfile(env, userId);
  if (!user) throw new Error("Unauthorized");
  if (!user.isApproved && !user.isAdmin) {
    throw new Error("Account pending approval");
  }
  return user;
};

export const updateUserProfile = async (
  env: Env,
  userId: string,
  patch: {
    username?: unknown;
    email?: unknown;
    bio?: unknown;
    accessRequestNote?: unknown;
    avatarUrl?: unknown;
  },
) => {
  const existing = await readUserRow(env, userId);
  if (!existing) throw new Error("User not found.");

  const nextName = patch.username === undefined ? sanitizeName(existing.username) : sanitizeName(patch.username);
  const nextEmail = patch.email === undefined ? sanitizeEmail(existing.email) : sanitizeEmail(patch.email);
  const nextBio = patch.bio === undefined ? existing.bio ?? "" : sanitizeBio(patch.bio) ?? "";
  const nextAccessRequestNote =
    patch.accessRequestNote === undefined
      ? existing.access_request_note ?? ""
      : sanitizeAccessRequestNote(patch.accessRequestNote) ?? "";
  const nextAvatar = patch.avatarUrl === undefined ? existing.avatar_url ?? "" : sanitizeAvatar(patch.avatarUrl);

  if (!nextName) throw new Error("Name is required (2-80 chars).");
  if (!nextEmail) throw new Error("Email is required and must be valid.");
  if (nextAvatar === null) throw new Error("Profile picture must be a valid http(s) URL or image data URL.");

  await env.DB.prepare(
    `UPDATE users
     SET username = ?, email = ?, bio = ?, access_request_note = ?, avatar_url = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      nextName,
      nextEmail,
      nextBio,
      nextAccessRequestNote,
      nextAvatar ?? "",
      new Date().toISOString(),
      userId,
    )
    .run();

  const profile = await fetchUserProfile(env, userId);
  if (!profile) throw new Error("User not found after update.");
  return profile;
};

export const listUsers = async (env: Env) => {
  await ensureSchema(env);
  const rows = await env.DB
    .prepare(
      "SELECT id, username, email, bio, access_request_note, avatar_url, is_admin, is_approved, approved_at, approved_by_user_id, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT 2000",
    )
    .all<UserRow>();
  return rows.results.map(toUserProfile);
};

export const setUserAdminFlag = async (env: Env, userId: string, isAdminRaw: unknown) => {
  const isAdmin = Boolean(isAdminRaw);
  await env.DB
    .prepare("UPDATE users SET is_admin = ?, updated_at = ? WHERE id = ?")
    .bind(isAdmin ? 1 : 0, new Date().toISOString(), userId)
    .run();
  const profile = await fetchUserProfile(env, userId);
  if (!profile) throw new Error("User not found.");
  return profile;
};

export const setUserApproval = async (
  env: Env,
  userId: string,
  approvedRaw: unknown,
  actorUserId: string,
) => {
  const approved = Boolean(approvedRaw);
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `UPDATE users
       SET is_approved = ?,
           approved_at = CASE WHEN ? = 1 THEN ? ELSE NULL END,
           approved_by_user_id = CASE WHEN ? = 1 THEN ? ELSE NULL END,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(approved ? 1 : 0, approved ? 1 : 0, now, approved ? 1 : 0, actorUserId, now, userId)
    .run();
  const profile = await fetchUserProfile(env, userId);
  if (!profile) throw new Error("User not found.");
  return profile;
};

const createResourceChange = async (
  env: Env,
  kind: "site" | "simulation",
  id: string,
  action: "created" | "updated",
  actorUserId: string,
  note: string,
) => {
  await env.DB
    .prepare(
      `INSERT INTO resource_changes (resource_kind, resource_id, action, actor_user_id, changed_at, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(kind, id, action, actorUserId, new Date().toISOString(), note)
    .run();
};

type ResourceRow = {
  owner_user_id: string;
  payload_json: string;
  name: string;
  visibility: Visibility;
  created_at: string | null;
};

const upsertOwnedResource = async (
  env: Env,
  kind: "site" | "simulation",
  ownerId: string,
  actorUserId: string,
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
  const now = new Date().toISOString();

  const existing = await env.DB
    .prepare(
      `SELECT owner_user_id, payload_json, name, visibility, created_at
       FROM ${table} WHERE id = ?`,
    )
    .bind(id)
    .first<ResourceRow>();

  if (existing && existing.owner_user_id !== ownerId) {
    return { ok: false, reason: `not_owner_${kind}` };
  }

  const isCreate = !existing;
  const changed =
    isCreate ||
    existing.payload_json !== payload ||
    existing.name !== name ||
    existing.visibility !== visibility;

  if (!changed) return { ok: true };

  await env.DB
    .prepare(
      `INSERT INTO ${table}
       (id, owner_user_id, created_by_user_id, last_edited_by_user_id, created_at, last_edited_at, name, visibility, payload_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         visibility = excluded.visibility,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at,
         last_edited_at = excluded.last_edited_at,
         last_edited_by_user_id = excluded.last_edited_by_user_id,
         created_by_user_id = COALESCE(${table}.created_by_user_id, excluded.created_by_user_id),
         created_at = COALESCE(${table}.created_at, excluded.created_at)`,
    )
    .bind(id, ownerId, ownerId, actorUserId, existing?.created_at ?? now, now, name, visibility, payload, now)
    .run();

  await env.DB.prepare(`DELETE FROM ${rolesTable} WHERE ${kind}_id = ?`).bind(id).run();
  if (sharedWith.length) {
    const statements = sharedWith
      .filter((grant) => grant.userId !== ownerId)
      .map((grant) =>
        env.DB
          .prepare(
            `INSERT INTO ${rolesTable} (${kind}_id, user_id, role, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(${kind}_id, user_id) DO UPDATE SET role = excluded.role`,
          )
          .bind(id, grant.userId, grant.role, now),
      );
    if (statements.length) {
      await env.DB.batch(statements);
    }
  }

  await createResourceChange(env, kind, id, isCreate ? "created" : "updated", actorUserId, name);

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
    const result = await upsertOwnedResource(env, "site", ownerId, ownerId, site);
    if (result.ok) upsertedSites += 1;
    else if (result.reason) conflicts.push(result.reason);
  }

  for (const simulation of payload.simulationPresets.slice(0, 4000)) {
    const result = await upsertOwnedResource(env, "simulation", ownerId, ownerId, simulation);
    if (result.ok) upsertedSimulations += 1;
    else if (result.reason) conflicts.push(result.reason);
  }

  return { upsertedSites, upsertedSimulations, conflicts };
};

const canEditByRole = (role: string | null, visibility: Visibility): boolean =>
  role === "admin" || role === "editor" || visibility === "public_write";

type LibraryRow = {
  payload_json: string;
  owner_user_id: string;
  visibility: Visibility;
  role: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  last_edited_by_user_id: string | null;
  last_edited_by_name: string | null;
  created_at: string | null;
  last_edited_at: string | null;
};

export const fetchLibraryForUser = async (
  env: Env,
  userId: string,
): Promise<{ siteLibrary: CloudResourceRecord[]; simulationPresets: CloudResourceRecord[] }> => {
  await ensureSchema(env);
  const siteRows = await env.DB
    .prepare(
      `SELECT s.payload_json, s.owner_user_id, s.visibility, r.role,
              s.created_by_user_id,
              (SELECT u.username FROM users u WHERE u.id = s.created_by_user_id) AS created_by_name,
              s.last_edited_by_user_id,
              (SELECT u.username FROM users u WHERE u.id = s.last_edited_by_user_id) AS last_edited_by_name,
              s.created_at,
              s.last_edited_at
       FROM sites s
       LEFT JOIN site_roles r ON r.site_id = s.id AND r.user_id = ?
       WHERE s.owner_user_id = ? OR r.user_id IS NOT NULL OR s.visibility IN ('public_read', 'public_write')`,
    )
    .bind(userId, userId)
    .all<LibraryRow>();

  const simulationRows = await env.DB
    .prepare(
      `SELECT s.payload_json, s.owner_user_id, s.visibility, r.role,
              s.created_by_user_id,
              (SELECT u.username FROM users u WHERE u.id = s.created_by_user_id) AS created_by_name,
              s.last_edited_by_user_id,
              (SELECT u.username FROM users u WHERE u.id = s.last_edited_by_user_id) AS last_edited_by_name,
              s.created_at,
              s.last_edited_at
       FROM simulations s
       LEFT JOIN simulation_roles r ON r.simulation_id = s.id AND r.user_id = ?
       WHERE s.owner_user_id = ? OR r.user_id IS NOT NULL OR s.visibility IN ('public_read', 'public_write')`,
    )
    .bind(userId, userId)
    .all<LibraryRow>();

  const mapRows = (rows: LibraryRow[]) =>
    rows
      .map((row) => {
        try {
          const parsed = JSON.parse(row.payload_json) as CloudResourceRecord;
          return {
            ...parsed,
            ownerUserId: row.owner_user_id,
            visibility: row.visibility,
            createdByUserId: row.created_by_user_id,
            createdByName: row.created_by_name,
            createdAt: row.created_at,
            lastEditedByUserId: row.last_edited_by_user_id,
            lastEditedByName: row.last_edited_by_name,
            lastEditedAt: row.last_edited_at,
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

  return {
    siteLibrary: mapRows(siteRows.results),
    simulationPresets: mapRows(simulationRows.results),
  };
};

export const fetchResourceChanges = async (
  env: Env,
  kind: "site" | "simulation",
  resourceId: string,
): Promise<
  Array<{
    id: number;
    action: string;
    changedAt: string;
    note: string | null;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl: string | null;
  }>
> => {
  await ensureSchema(env);
  const rows = await env.DB
    .prepare(
      `SELECT c.id, c.action, c.changed_at, c.note, c.actor_user_id,
              u.username AS actor_name,
              u.avatar_url AS actor_avatar_url
       FROM resource_changes c
       LEFT JOIN users u ON u.id = c.actor_user_id
       WHERE c.resource_kind = ? AND c.resource_id = ?
       ORDER BY c.changed_at DESC
       LIMIT 300`,
    )
    .bind(kind, resourceId)
    .all<{
      id: number;
      action: string;
      changed_at: string;
      note: string | null;
      actor_user_id: string;
      actor_name: string | null;
      actor_avatar_url: string | null;
    }>();

  return rows.results.map((row) => ({
    id: row.id,
    action: row.action,
    changedAt: row.changed_at,
    note: row.note,
    actorUserId: row.actor_user_id,
    actorName: row.actor_name,
    actorAvatarUrl: row.actor_avatar_url,
  }));
};
