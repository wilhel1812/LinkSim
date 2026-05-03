import type { CloudResourceRecord, DbVisibility, Env, Grant, ResourceRole, UserRole, Visibility } from "./types";
import { findPresetById } from "../../src/lib/frequencyPlans";

const VISIBILITIES: Visibility[] = ["private", "public", "shared"];
const DB_VISIBILITIES: DbVisibility[] = ["private", "public_read", "public_write"];
const ROLES: ResourceRole[] = ["viewer", "editor", "admin"];

let schemaReady: Promise<void> | null = null;
const SCHEMA_VERSION = "2026-05-03a";
type AccountState = "pending" | "approved" | "revoked";

const dbVisibilityFromVisibility = (value: Visibility): DbVisibility => {
  if (value === "public") return "public_read";
  if (value === "shared") return "public_write";
  return "private";
};

const visibilityFromDbVisibility = (value: unknown): Visibility => {
  if (value === "public_write") return "shared";
  if (value === "public_read") return "public";
  return "private";
};

const sanitizeVisibility = (value: unknown): Visibility => {
  if (typeof value !== "string") return "private";
  if (VISIBILITIES.includes(value as Visibility)) return value as Visibility;
  if (DB_VISIBILITIES.includes(value as DbVisibility)) return visibilityFromDbVisibility(value);
  return "private";
};

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

const slugifyName = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/ß/g, "ss")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const DELIMITER_CHARS = /[+<>~/]/g;
const VARIATION_SELECTORS = /[\uFE0E\uFE0F]/g;

export const canonicalizeSimulationLookupKey = (value: string): string =>
  value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(VARIATION_SELECTORS, "")
    .replace(DELIMITER_CHARS, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

const sanitizeSlugAliasList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const slug = slugifyName(item);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
};

const isMeaningfulChangeField = (field: string): boolean => {
  const normalized = field.trim();
  if (!normalized) return false;
  const ignored = new Set([
    "content",
    "updatedAt",
    "updated_at",
    "lastEditedAt",
    "last_edited_at",
    "lastEditedByUserId",
    "last_edited_by_user_id",
    "lastEditedByName",
    "lastEditedByAvatarUrl",
    "createdAt",
    "created_at",
    "slugAliases",
    "slug_aliases",
  ]);
  return !ignored.has(normalized);
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

const sanitizeBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

const sanitizeAvatar = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
};

const sanitizeDefaultFrequencyPresetId = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("Default frequency preset must be a string or null.");
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!findPresetById(trimmed)) throw new Error("Unknown default frequency preset.");
  return trimmed;
};

const deriveDefaultEmail = (userId: string, tokenPayload?: Record<string, unknown>): string => {
  const fromEmail = sanitizeEmail(tokenPayload?.email);
  if (fromEmail) return fromEmail;
  const fromUserId = sanitizeEmail(userId);
  if (fromUserId) return fromUserId;
  return `${userId.slice(0, 12)}@users.linksim.local`;
};

const deriveVerifiedIdpEmail = (tokenPayload?: Record<string, unknown>): string => {
  const fromPayload = sanitizeEmail(tokenPayload?.email);
  return fromPayload ?? "";
};

const parseTokenIssuedAtMs = (tokenPayload?: Record<string, unknown>): number | null => {
  if (!tokenPayload) return null;
  const raw = tokenPayload.iat;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw * 1000;
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed * 1000;
  }
  return null;
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

const REQUIRED_COLUMNS: Record<string, string[]> = {
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

export const getSchemaDiagnostics = async (env: Env): Promise<{
  version: string;
  ok: boolean;
  missing: Array<{ table: string; columns: string[] }>;
}> => {
  const missing: Array<{ table: string; columns: string[] }> = [];
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const pragma = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const existing = new Set(pragma.results.map((col) => col.name));
    const missingColumns = required.filter((col) => !existing.has(col));
    if (missingColumns.length) missing.push({ table, columns: missingColumns });
  }
  return { version: SCHEMA_VERSION, ok: missing.length === 0, missing };
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
            username_set_at TEXT,
            bio TEXT,
            access_request_note TEXT,
            idp_email TEXT,
            idp_email_verified INTEGER NOT NULL DEFAULT 0,
            avatar_url TEXT,
            email_public INTEGER NOT NULL DEFAULT 1,
            default_frequency_preset_id TEXT,
            avatar_object_key TEXT,
            avatar_thumb_key TEXT,
            avatar_hash TEXT,
            avatar_bytes INTEGER,
            avatar_content_type TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0,
            is_moderator INTEGER NOT NULL DEFAULT 0,
            is_approved INTEGER NOT NULL DEFAULT 0,
            approved_at TEXT,
            approved_by_user_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT
          )`,
        ),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS deleted_users (
            id TEXT PRIMARY KEY,
            deleted_at TEXT NOT NULL,
            deleted_by_user_id TEXT
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
            note TEXT,
            details_json TEXT,
            snapshot_json TEXT
          )`,
        ),
        env.DB.prepare(
          `CREATE TABLE IF NOT EXISTS user_identity_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            target_user_id TEXT NOT NULL,
            source_user_id TEXT,
            actor_user_id TEXT,
            idp_email TEXT,
            details_json TEXT,
            created_at TEXT NOT NULL
          )`,
        ),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sites_owner ON sites(owner_user_id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_sites_visibility ON sites(visibility)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_site_roles_user ON site_roles(user_id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_simulations_owner ON simulations(owner_user_id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_simulations_visibility ON simulations(visibility)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_simulation_roles_user ON simulation_roles(user_id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_resource_changes_lookup ON resource_changes(resource_kind, resource_id, changed_at DESC)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_identity_audit_target ON user_identity_audit(target_user_id, created_at DESC)"),
      ]);

      // Backfill additive user columns for existing databases before strict diagnostics.
      const userTableInfo = await env.DB.prepare("PRAGMA table_info(users)").all<{ name: string }>();
      const userColumns = new Set(userTableInfo.results.map((column) => column.name));
      if (!userColumns.has("default_frequency_preset_id")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN default_frequency_preset_id TEXT").run();
      }
      if (!userColumns.has("username_set_at")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN username_set_at TEXT").run();
        await env.DB
          .prepare(
            `UPDATE users
             SET username_set_at = COALESCE(updated_at, created_at)
             WHERE COALESCE(TRIM(username), '') != ''`,
          )
          .run();
      }

      const now = new Date().toISOString();
      await env.DB
        .prepare(
          `UPDATE users
           SET is_approved = 1,
               approved_at = COALESCE(approved_at, ?),
               approved_by_user_id = COALESCE(approved_by_user_id, 'system:open-registration'),
               updated_at = ?
           WHERE is_admin = 0
             AND is_moderator = 0
             AND is_approved = 0
             AND (approved_by_user_id IS NULL OR approved_by_user_id NOT LIKE 'revoked:%')`,
        )
        .bind(now, now)
        .run();

      const diagnostics = await getSchemaDiagnostics(env);
      if (!diagnostics.ok) {
        const summary = diagnostics.missing
          .map((entry) => `${entry.table}: ${entry.columns.join(",")}`)
          .join(" | ");
        throw new Error(`Schema out of date. Run D1 migrations. Missing: ${summary}`);
      }
    })().catch((error) => {
      // Allow next request to retry schema checks instead of pinning a rejected promise forever.
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
};

type UserRow = {
  id: string;
  username: string | null;
  email: string | null;
  username_set_at: string | null;
  bio: string | null;
  access_request_note: string | null;
  idp_email: string | null;
  idp_email_verified: number;
  avatar_url: string | null;
  email_public: number;
  default_frequency_preset_id: string | null;
  avatar_object_key: string | null;
  avatar_thumb_key: string | null;
  avatar_hash: string | null;
  avatar_bytes: number | null;
  avatar_content_type: string | null;
  is_admin: number;
  is_moderator: number;
  is_approved: number;
  approved_at: string | null;
  approved_by_user_id: string | null;
  created_at: string;
  updated_at: string | null;
};

type IdentityMatchKind = "verified_idp_email" | "legacy_email";
type IdentityReconcileCandidate = UserRow & { match_kind: IdentityMatchKind };

const matchRank = (kind: IdentityMatchKind): number => (kind === "verified_idp_email" ? 2 : 1);

const normalizeDateSafe = (value: string | null): number => {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
};

export const chooseIdentityReconcileCandidate = (
  candidates: IdentityReconcileCandidate[],
): IdentityReconcileCandidate | null => {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => {
    const rankDiff = matchRank(b.match_kind) - matchRank(a.match_kind);
    if (rankDiff !== 0) return rankDiff;
    if (a.is_admin !== b.is_admin) return b.is_admin - a.is_admin;
    if (a.is_moderator !== b.is_moderator) return b.is_moderator - a.is_moderator;
    if (a.is_approved !== b.is_approved) return b.is_approved - a.is_approved;
    const createdDiff = normalizeDateSafe(a.created_at) - normalizeDateSafe(b.created_at);
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  });
  return sorted[0] ?? null;
};

const toUserProfile = (row: UserRow) => ({
  id: row.id,
  username: sanitizeName(row.username) ?? "",
  needsUsername: !row.username_set_at,
  email: sanitizeEmail(row.email) ?? "unknown@users.linksim.local",
  bio: row.bio ?? "",
  accessRequestNote: row.access_request_note ?? "",
  idpEmail: row.idp_email ?? "",
  idpEmailVerified: row.idp_email_verified === 1,
  avatarUrl: row.avatar_url ?? "",
  emailPublic: row.email_public === 1,
  defaultFrequencyPresetId: row.default_frequency_preset_id,
  avatarObjectKey: row.avatar_object_key ?? "",
  avatarThumbKey: row.avatar_thumb_key ?? "",
  avatarHash: row.avatar_hash ?? "",
  avatarBytes: row.avatar_bytes ?? 0,
  avatarContentType: row.avatar_content_type ?? "",
  isAdmin: row.is_admin === 1,
  isModerator: row.is_moderator === 1,
  isApproved: row.is_approved === 1,
  role:
    row.is_admin === 1
      ? ("admin" as UserRole)
      : row.is_moderator === 1
        ? ("moderator" as UserRole)
        : row.is_approved === 1
          ? ("user" as UserRole)
          : ("pending" as UserRole),
  accountState:
    row.is_admin === 1 || row.is_moderator === 1 || row.is_approved === 1
      ? ("approved" as AccountState)
      : typeof row.approved_by_user_id === "string" && row.approved_by_user_id.startsWith("revoked:")
        ? ("revoked" as AccountState)
        : ("pending" as AccountState),
  approvedAt: row.approved_at,
  approvedByUserId: row.approved_by_user_id,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const readUserRow = async (env: Env, userId: string): Promise<UserRow | null> => {
  await ensureSchema(env);
  return env.DB
    .prepare(
      "SELECT id, username, email, username_set_at, bio, access_request_note, idp_email, idp_email_verified, avatar_url, email_public, default_frequency_preset_id, avatar_object_key, avatar_thumb_key, avatar_hash, avatar_bytes, avatar_content_type, is_admin, is_moderator, is_approved, approved_at, approved_by_user_id, created_at, updated_at FROM users WHERE id = ?",
    )
    .bind(userId)
    .first<UserRow>();
};

const reconcileUserIdentityByIdpEmail = async (
  env: Env,
  userId: string,
  idpEmail: string,
): Promise<void> => {
  const normalized = sanitizeEmail(idpEmail);
  if (!normalized) return;

  const rows = await env.DB
    .prepare(
      `SELECT id, username, email, username_set_at, bio, access_request_note, idp_email, idp_email_verified, avatar_url, email_public, default_frequency_preset_id, avatar_object_key, avatar_thumb_key, avatar_hash, avatar_bytes, avatar_content_type, is_admin, is_moderator, is_approved, approved_at, approved_by_user_id, created_at, updated_at,
              CASE
                WHEN lower(idp_email) = lower(?) AND idp_email_verified = 1 THEN 'verified_idp_email'
                WHEN lower(email) = lower(?) THEN 'legacy_email'
                ELSE NULL
              END AS match_kind
       FROM users
       WHERE id <> ?
         AND (
           (lower(idp_email) = lower(?) AND idp_email_verified = 1)
           OR lower(email) = lower(?)
         )
       LIMIT 25`,
    )
    .bind(normalized, normalized, userId, normalized, normalized)
    .all<IdentityReconcileCandidate>();
  const existing = chooseIdentityReconcileCandidate(
    rows.results.filter(
      (row): row is IdentityReconcileCandidate =>
        row.match_kind === "verified_idp_email" || row.match_kind === "legacy_email",
    ),
  );
  if (!existing) return;

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `UPDATE users
       SET is_admin = CASE WHEN ? = 1 THEN 1 ELSE is_admin END,
           is_moderator = CASE WHEN ? = 1 THEN 1 ELSE is_moderator END,
           is_approved = CASE WHEN ? = 1 THEN 1 ELSE is_approved END,
           approved_at = CASE WHEN ? = 1 THEN COALESCE(approved_at, ?) ELSE approved_at END,
           approved_by_user_id = CASE WHEN ? = 1 THEN COALESCE(approved_by_user_id, ?) ELSE approved_by_user_id END,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      existing.is_admin === 1 ? 1 : 0,
      existing.is_moderator === 1 ? 1 : 0,
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

  await env.DB
    .prepare(
      `INSERT INTO user_identity_audit
       (event_type, target_user_id, source_user_id, actor_user_id, idp_email, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      "reconciled_by_verified_idp_email",
      userId,
      existing.id,
      userId,
      normalized,
      JSON.stringify({
        mergedFromUserId: existing.id,
        matchKind: existing.match_kind,
        mergedFromIsAdmin: existing.is_admin === 1,
        mergedFromIsModerator: existing.is_moderator === 1,
        mergedFromIsApproved: existing.is_approved === 1,
      }),
      now,
    )
    .run();
};

export const ensureUser = async (
  env: Env,
  userId: string,
  tokenPayload?: Record<string, unknown>,
): Promise<void> => {
  await ensureSchema(env);
  const deletion = await env.DB
    .prepare("SELECT deleted_at FROM deleted_users WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<{ deleted_at: string }>();
  if (deletion?.deleted_at) {
    const tokenIssuedAtMs = parseTokenIssuedAtMs(tokenPayload);
    const deletedAtMs = Date.parse(deletion.deleted_at);
    if (!Number.isFinite(deletedAtMs) || tokenIssuedAtMs === null || tokenIssuedAtMs <= deletedAtMs) {
      throw new Error("Session revoked by admin");
    }
    await env.DB.prepare("DELETE FROM deleted_users WHERE id = ?").bind(userId).run();
  }
  const now = new Date().toISOString();
  const email = deriveDefaultEmail(userId, tokenPayload);
  const idpEmail = deriveVerifiedIdpEmail(tokenPayload);
  const idpEmailVerified = idpEmail ? 1 : 0;
  const isBootstrapAdmin = parseAdminUserIds(env).has(userId.toLowerCase()) ? 1 : 0;
  const autoApprove = 1;

  await env.DB.prepare(
    `INSERT OR IGNORE INTO users
      (id, username, email, username_set_at, bio, access_request_note, idp_email, idp_email_verified, avatar_url, email_public, avatar_object_key, avatar_thumb_key, avatar_hash, avatar_bytes, avatar_content_type, is_admin, is_moderator, is_approved, approved_at, approved_by_user_id, created_at, updated_at)
     VALUES (?, '', ?, NULL, '', '', ?, ?, '', 1, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      userId,
      email,
      idpEmail || null,
      idpEmailVerified,
      isBootstrapAdmin,
      0,
      autoApprove,
      now,
      "system:open-registration",
      now,
      now,
    )
    .run();

  await env.DB.prepare(
    `UPDATE users
     SET email = COALESCE(NULLIF(TRIM(email), ''), ?),
         idp_email = CASE WHEN ? = 1 THEN COALESCE(NULLIF(TRIM(idp_email), ''), ?) ELSE idp_email END,
         idp_email_verified = CASE WHEN ? = 1 THEN 1 ELSE idp_email_verified END,
         is_admin = CASE WHEN ? = 1 THEN 1 ELSE is_admin END,
         is_moderator = CASE WHEN ? = 1 THEN 1 ELSE is_moderator END,
         is_approved = CASE WHEN ? = 1 AND (approved_by_user_id IS NULL OR approved_by_user_id NOT LIKE 'revoked:%') THEN 1 ELSE is_approved END,
         approved_at = CASE WHEN ? = 1 AND approved_at IS NULL THEN ? ELSE approved_at END,
         approved_by_user_id = CASE WHEN ? = 1 AND approved_by_user_id IS NULL THEN ? ELSE approved_by_user_id END,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      email,
      idpEmailVerified,
      idpEmail || null,
      idpEmailVerified,
      isBootstrapAdmin,
      0,
      autoApprove,
      autoApprove,
      now,
      autoApprove,
      "system:open-registration",
      now,
      userId,
    )
    .run();

  if (idpEmailVerified) {
    await reconcileUserIdentityByIdpEmail(env, userId, idpEmail);
  }
};

export const fetchUserProfile = async (env: Env, userId: string) => {
  const row = await readUserRow(env, userId);
  return row ? toUserProfile(row) : null;
};

export const assertUserAccess = async (env: Env, userId: string) => {
  const user = await fetchUserProfile(env, userId);
  if (!user) throw new Error("Unauthorized");
  if (user.accountState === "revoked") {
    throw new Error("Account access revoked by admin");
  }
  if (user.accountState !== "approved") {
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
    emailPublic?: unknown;
    defaultFrequencyPresetId?: unknown;
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
  const nextEmailPublic =
    patch.emailPublic === undefined ? existing.email_public === 1 : sanitizeBoolean(patch.emailPublic, true);
  const nextDefaultFrequencyPresetId =
    patch.defaultFrequencyPresetId === undefined
      ? (existing.default_frequency_preset_id ?? null)
      : sanitizeDefaultFrequencyPresetId(patch.defaultFrequencyPresetId);
  const shouldClearAvatarMetadata =
    patch.avatarUrl !== undefined && (nextAvatar ?? "") !== (existing.avatar_url ?? "");

  if (!nextName) throw new Error("Name is required (2-80 chars).");
  if (!nextEmail) throw new Error("Email is required and must be valid.");
  if (nextAvatar === null) throw new Error("Profile picture must be a valid http(s) URL.");

  const duplicateUser = await env.DB
    .prepare("SELECT id FROM users WHERE lower(username) = lower(?) AND id != ? LIMIT 1")
    .bind(nextName, userId)
    .first<{ id: string }>();
  if (duplicateUser?.id) throw new Error("Username is already in use.");

  await env.DB.prepare(
    `UPDATE users
     SET username = ?,
         username_set_at = CASE WHEN ? = 1 THEN COALESCE(username_set_at, ?) ELSE username_set_at END,
         email = ?,
         bio = ?,
         access_request_note = ?,
         avatar_url = ?,
         email_public = ?,
         default_frequency_preset_id = ?,
         avatar_object_key = ?,
         avatar_thumb_key = ?,
         avatar_hash = ?,
         avatar_bytes = ?,
         avatar_content_type = ?,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      nextName,
      patch.username === undefined ? 0 : 1,
      new Date().toISOString(),
      nextEmail,
      nextBio,
      nextAccessRequestNote,
      nextAvatar ?? "",
      nextEmailPublic ? 1 : 0,
      nextDefaultFrequencyPresetId ?? null,
      shouldClearAvatarMetadata ? null : existing.avatar_object_key,
      shouldClearAvatarMetadata ? null : existing.avatar_thumb_key,
      shouldClearAvatarMetadata ? null : existing.avatar_hash,
      shouldClearAvatarMetadata ? null : existing.avatar_bytes,
      shouldClearAvatarMetadata ? null : existing.avatar_content_type,
      new Date().toISOString(),
      userId,
    )
    .run();

  const profile = await fetchUserProfile(env, userId);
  if (!profile) throw new Error("User not found after update.");
  return profile;
};

export const setUserAvatarAssets = async (
  env: Env,
  userId: string,
  avatar: {
    avatarUrl: string;
    avatarObjectKey: string;
    avatarThumbKey: string;
    avatarHash: string;
    avatarBytes: number;
    avatarContentType: string;
  },
) => {
  await ensureSchema(env);
  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `UPDATE users
       SET avatar_url = ?,
           avatar_object_key = ?,
           avatar_thumb_key = ?,
           avatar_hash = ?,
           avatar_bytes = ?,
           avatar_content_type = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      avatar.avatarUrl,
      avatar.avatarObjectKey,
      avatar.avatarThumbKey,
      avatar.avatarHash,
      avatar.avatarBytes,
      avatar.avatarContentType,
      now,
      userId,
    )
    .run();
  const profile = await fetchUserProfile(env, userId);
  if (!profile) throw new Error("User not found after avatar update.");
  return profile;
};

export const getUserAvatarKeys = async (
  env: Env,
  userId: string,
): Promise<{ avatarObjectKey: string | null; avatarThumbKey: string | null }> => {
  await ensureSchema(env);
  const row = await env.DB
    .prepare("SELECT avatar_object_key, avatar_thumb_key FROM users WHERE id = ? LIMIT 1")
    .bind(userId)
    .first<{ avatar_object_key: string | null; avatar_thumb_key: string | null }>();
  return {
    avatarObjectKey: row?.avatar_object_key ?? null,
    avatarThumbKey: row?.avatar_thumb_key ?? null,
  };
};

export const listUsers = async (env: Env) => {
  await ensureSchema(env);
  const rows = await env.DB
    .prepare(
      "SELECT id, username, email, username_set_at, bio, access_request_note, idp_email, idp_email_verified, avatar_url, email_public, default_frequency_preset_id, avatar_object_key, avatar_thumb_key, avatar_hash, avatar_bytes, avatar_content_type, is_admin, is_moderator, is_approved, approved_at, approved_by_user_id, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT 2000",
    )
    .all<UserRow>();
  return rows.results.map(toUserProfile);
};

export const listCollaboratorDirectory = async (env: Env) => {
  await ensureSchema(env);
  const rows = await env.DB
    .prepare(
      `SELECT id, username,
              CASE WHEN email_public = 1 THEN COALESCE(email, idp_email, '') ELSE '' END AS visible_email,
              COALESCE(avatar_url, '') AS avatar_url
       FROM users
       WHERE (is_admin = 1 OR is_moderator = 1 OR is_approved = 1)
         AND (approved_by_user_id IS NULL OR approved_by_user_id NOT LIKE 'revoked:%')
       ORDER BY username COLLATE NOCASE ASC
       LIMIT 4000`,
    )
    .all<{ id: string; username: string; visible_email: string; avatar_url: string }>();
  return rows.results.map((row) => ({
    id: row.id,
    username: row.username,
    email: row.visible_email,
    avatarUrl: row.avatar_url,
  }));
};

export const setUserAdminFlag = async (env: Env, userId: string, isAdminRaw: unknown) => {
  const isAdmin = Boolean(isAdminRaw);
  await env.DB
    .prepare("UPDATE users SET is_admin = ?, is_moderator = CASE WHEN ? = 1 THEN 0 ELSE is_moderator END, updated_at = ? WHERE id = ?")
    .bind(isAdmin ? 1 : 0, isAdmin ? 1 : 0, new Date().toISOString(), userId)
    .run();
  const profile = await fetchUserProfile(env, userId);
  if (!profile) throw new Error("User not found.");
  return profile;
};

export const setUserRole = async (env: Env, userId: string, role: UserRole, actorUserId: string) => {
  const now = new Date().toISOString();
  const revokedBy = `revoked:${actorUserId}`;
  if (role === "admin") {
    await env.DB
      .prepare(
        `UPDATE users
         SET is_admin = 1,
             is_moderator = 0,
             is_approved = 1,
             approved_at = COALESCE(approved_at, ?),
             approved_by_user_id = COALESCE(approved_by_user_id, ?),
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, actorUserId, now, userId)
      .run();
  } else if (role === "moderator") {
    await env.DB
      .prepare(
        `UPDATE users
         SET is_admin = 0,
             is_moderator = 1,
             is_approved = 1,
             approved_at = COALESCE(approved_at, ?),
             approved_by_user_id = COALESCE(approved_by_user_id, ?),
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, actorUserId, now, userId)
      .run();
  } else if (role === "user") {
    await env.DB
      .prepare(
        `UPDATE users
         SET is_admin = 0,
             is_moderator = 0,
             is_approved = 1,
             approved_at = COALESCE(approved_at, ?),
             approved_by_user_id = COALESCE(approved_by_user_id, ?),
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(now, actorUserId, now, userId)
      .run();
  } else {
    await env.DB
      .prepare(
        `UPDATE users
         SET is_admin = 0,
             is_moderator = 0,
             is_approved = 0,
             approved_at = approved_at,
             approved_by_user_id = CASE
               WHEN approved_at IS NULL THEN NULL
               ELSE ?
             END,
             updated_at = ?
         WHERE id = ?`,
      )
      .bind(revokedBy, now, userId)
      .run();
  }
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
  return setUserRole(env, userId, approved ? "user" : "pending", actorUserId);
};

export const deleteUser = async (env: Env, userId: string, actorUserId?: string): Promise<void> => {
  await ensureSchema(env);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO deleted_users (id, deleted_at, deleted_by_user_id)
         VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at, deleted_by_user_id = excluded.deleted_by_user_id`,
      )
      .bind(userId, now, actorUserId ?? null),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);
};

export const listDeletedUsers = async (
  env: Env,
): Promise<Array<{ id: string; deletedAt: string; deletedByUserId: string | null }>> => {
  await ensureSchema(env);
  const rows = await env.DB
    .prepare(
      `SELECT id, deleted_at, deleted_by_user_id
       FROM deleted_users
       ORDER BY deleted_at DESC
       LIMIT 500`,
    )
    .all<{
      id: string;
      deleted_at: string;
      deleted_by_user_id: string | null;
    }>();

  return rows.results.map((row) => ({
    id: row.id,
    deletedAt: row.deleted_at,
    deletedByUserId: row.deleted_by_user_id,
  }));
};

export const restoreDeletedUser = async (env: Env, userId: string): Promise<void> => {
  await ensureSchema(env);
  await env.DB.prepare("DELETE FROM deleted_users WHERE id = ?").bind(userId).run();
};

export const listPendingApprovalUsers = async (
  env: Env,
): Promise<Array<{ id: string; username: string; email: string; createdAt: string; accessRequestNote: string }>> => {
  await ensureSchema(env);
  const rows = await env.DB
    .prepare(
      `SELECT id, username, email, created_at, access_request_note
       FROM users
       WHERE is_admin = 0
         AND is_moderator = 0
         AND is_approved = 0
         AND (approved_by_user_id IS NULL OR approved_by_user_id NOT LIKE 'revoked:%')
       ORDER BY created_at ASC
       LIMIT 200`,
    )
    .all<{
      id: string;
      username: string | null;
      email: string | null;
      created_at: string;
      access_request_note: string | null;
    }>();

  return rows.results.map((row) => ({
    id: row.id,
    username: sanitizeName(row.username) ?? row.id,
    email: sanitizeEmail(row.email) ?? "",
    createdAt: row.created_at,
    accessRequestNote: row.access_request_note ?? "",
  }));
};

const createResourceChange = async (
  env: Env,
  kind: "site" | "simulation",
  id: string,
  action: "created" | "updated",
  actorUserId: string,
  note: string,
  options?: {
    details?: Record<string, unknown>;
    snapshot?: Record<string, unknown>;
  },
) => {
  await env.DB
    .prepare(
      `INSERT INTO resource_changes (resource_kind, resource_id, action, actor_user_id, changed_at, note, details_json, snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      kind,
      id,
      action,
      actorUserId,
      new Date().toISOString(),
      note,
      options?.details ? JSON.stringify(options.details) : null,
      options?.snapshot ? JSON.stringify(options.snapshot) : null,
    )
    .run();
};

const createAdminAuditEvent = async (
  env: Env,
  eventType: string,
  actorUserId: string,
  details: Record<string, unknown>,
  targetUserId?: string,
  sourceUserId?: string,
) => {
  await env.DB
    .prepare(
      `INSERT INTO user_identity_audit
       (event_type, target_user_id, source_user_id, actor_user_id, idp_email, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      eventType,
      targetUserId ?? actorUserId,
      sourceUserId ?? null,
      actorUserId,
      null,
      JSON.stringify(details),
      new Date().toISOString(),
    )
    .run();
};

type ResourceRow = {
  owner_user_id: string;
  payload_json: string;
  name: string;
  visibility: DbVisibility;
  created_at: string | null;
};

type ActorPolicy = {
  id: string;
  isAdmin: boolean;
  isModerator: boolean;
};

const referencedLibrarySiteIdsFromSimulation = (item: CloudResourceRecord): string[] => {
  const snapshot = (item as { snapshot?: unknown }).snapshot;
  if (!snapshot || typeof snapshot !== "object") return [];
  const rawSites = (snapshot as { sites?: unknown }).sites;
  if (!Array.isArray(rawSites)) return [];
  const ids = new Set<string>();
  for (const site of rawSites) {
    if (!site || typeof site !== "object") continue;
    const libraryEntryId = (site as { libraryEntryId?: unknown }).libraryEntryId;
    if (typeof libraryEntryId !== "string") continue;
    const trimmed = libraryEntryId.trim();
    if (!trimmed) continue;
    ids.add(trimmed);
  }
  return [...ids];
};

const canReadResource = (
  actor: ActorPolicy,
  ownerUserId: string,
  visibility: Visibility,
  explicitRole: string | null,
): boolean => {
  if (actor.isAdmin) return true;
  if (ownerUserId === actor.id) return true;
  if (explicitRole !== null) return true;
  return visibility === "public" || visibility === "shared";
};

const canEditResource = (
  actor: ActorPolicy,
  ownerUserId: string,
  _visibility: Visibility,
  explicitRole: string | null,
): boolean => {
  if (actor.isAdmin) return true;
  if (ownerUserId === actor.id) return true;
  if (explicitRole === "admin" || explicitRole === "editor") return true;
  // Moderators must be explicit collaborators (or owners) to edit resources they do not own.
  if (actor.isModerator) return false;
  return false;
};

const upsertOwnedResource = async (
  env: Env,
  kind: "site" | "simulation",
  actor: ActorPolicy,
  item: CloudResourceRecord,
): Promise<{ ok: boolean; reason?: string }> => {
  const table = kind === "site" ? "sites" : "simulations";
  const rolesTable = kind === "site" ? "site_roles" : "simulation_roles";

  const id = typeof item.id === "string" ? item.id.trim() : "";
  const name = sanitizeName(item.name);
  if (!id || !name) return { ok: false, reason: `invalid_${kind}` };

  const visibility = sanitizeVisibility(item.visibility);
  const visibilityDb = dbVisibilityFromVisibility(visibility);
  const requestedSharedWith = sanitizeGrants(item.sharedWith);
  const now = new Date().toISOString();

  const existing = await env.DB
    .prepare(
      `SELECT t.owner_user_id, t.payload_json, t.name, t.visibility, t.created_at, r.role AS actor_role
       FROM ${table} t
       LEFT JOIN ${rolesTable} r ON r.${kind}_id = t.id AND r.user_id = ?
       WHERE t.id = ?`,
    )
    .bind(actor.id, id)
    .first<ResourceRow & { actor_role?: string | null }>();

  if (existing) {
    const existingVisibility = visibilityFromDbVisibility(existing.visibility);
    const actorRole = typeof existing.actor_role === "string" ? existing.actor_role : null;
    if (!canEditResource(actor, existing.owner_user_id, existingVisibility, actorRole)) {
      return { ok: false, reason: `forbidden_${kind}` };
    }
  }

  const ownerId = existing?.owner_user_id ?? actor.id;
  const sharedWith = requestedSharedWith.filter((grant) => grant.userId !== ownerId);

  if (kind === "simulation") {
    const duplicate = await env.DB
      .prepare(
        `SELECT id
         FROM simulations
         WHERE lower(name) = lower(?)
           AND owner_user_id = ?
           AND id != ?
         LIMIT 1`,
      )
      .bind(name, ownerId, id)
      .first<{ id: string }>();
    if (duplicate?.id) {
      return { ok: false, reason: "simulation_name_taken" };
    }
  }

  const existingPayload = existing ? (JSON.parse(existing.payload_json) as CloudResourceRecord) : null;
  const simulationSlug = kind === "simulation" ? slugifyName(name) : "";
  const previousSlug =
    kind === "simulation" && existingPayload && typeof existingPayload.slug === "string"
      ? slugifyName(existingPayload.slug)
      : "";
  const aliasSeed = kind === "simulation" ? sanitizeSlugAliasList(existingPayload?.slugAliases) : [];
  const slugAliases =
    kind === "simulation"
      ? Array.from(new Set([...(previousSlug ? [previousSlug] : []), ...aliasSeed].filter((entry) => entry && entry !== simulationSlug)))
      : [];
  const nextRecord: CloudResourceRecord = {
    ...item,
    visibility,
    sharedWith,
    ...(kind === "simulation" ? { slug: simulationSlug, slugAliases } : {}),
  };
  const payload = JSON.stringify(nextRecord);

  const isCreate = !existing;
  const changed =
    isCreate ||
    existing.payload_json !== payload ||
    existing.name !== name ||
    existing.visibility !== visibilityDb;

  if (!changed) return { ok: true };

  if (existing) {
    const existingPayloadForGrants = JSON.parse(existing.payload_json) as CloudResourceRecord;
    const existingGrants = sanitizeGrants(existingPayloadForGrants.sharedWith).filter((grant) => grant.userId !== ownerId);
    const existingGrantUsers = new Set(existingGrants.map((grant) => grant.userId));
    const nextGrantUsers = new Set(sharedWith.map((grant) => grant.userId));
    const removedCollaborators = [...existingGrantUsers].filter((userId) => !nextGrantUsers.has(userId));
    if (removedCollaborators.length > 0 && !(actor.isAdmin || actor.isModerator || ownerId === actor.id)) {
      return { ok: false, reason: `cannot_remove_collaborator_${kind}` };
    }
  }

  const actorRoleAfter =
    ownerId === actor.id
      ? "owner"
      : sharedWith.find((grant) => grant.userId === actor.id)?.role ??
        (visibility === "shared" ? "editor" : visibility === "public" ? "viewer" : null);
  if (!canReadResource(actor, ownerId, visibility, actorRoleAfter)) {
    return { ok: false, reason: `would_lose_access_${kind}` };
  }

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
    .bind(id, ownerId, ownerId, actor.id, existing?.created_at ?? now, now, name, visibilityDb, payload, now)
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

  const changeDetails: string[] = [];
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  if (isCreate) {
    changeDetails.push("initial record");
  } else {
    if (existing && existing.name !== name) {
      changeDetails.push("name");
      diff.name = { before: existing.name, after: name };
    }
    if (existing && visibilityFromDbVisibility(existing.visibility) !== visibility) {
      changeDetails.push("visibility");
      diff.visibility = { before: visibilityFromDbVisibility(existing.visibility), after: visibility };
    }
    if (existing && existing.payload_json !== payload) {
      const beforePayload = JSON.parse(existing.payload_json) as Record<string, unknown>;
      const afterPayload = nextRecord as Record<string, unknown>;
      const keys = new Set([...Object.keys(beforePayload), ...Object.keys(afterPayload)]);
      for (const key of keys) {
        if (key === "updatedAt") continue;
        const before = beforePayload[key];
        const after = afterPayload[key];
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          diff[key] = { before, after };
        }
      }
      if (Object.keys(diff).some((key) => isMeaningfulChangeField(key))) {
        changeDetails.push("content");
      }
    }
  }
  const meaningfulChangedFields = Object.keys(diff).filter(isMeaningfulChangeField);
  const summaryDetails = changeDetails.filter((detail) => detail !== "content" || meaningfulChangedFields.length > 0);
  const note = isCreate
    ? `Created "${name}" (${summaryDetails.join(", ") || "initial record"})`
    : `Updated "${name}" (${summaryDetails.join(", ") || "record"})`;
  await createResourceChange(env, kind, id, isCreate ? "created" : "updated", actor.id, note, {
    details: {
      changedFields: meaningfulChangedFields,
      diff,
    },
    snapshot: nextRecord as Record<string, unknown>,
  });

  return { ok: true };
};

export const upsertLibrarySnapshot = async (
  env: Env,
  actor: ActorPolicy,
  payload: { siteLibrary: CloudResourceRecord[]; simulationPresets: CloudResourceRecord[] },
): Promise<{ upsertedSites: number; upsertedSimulations: number; conflicts: string[] }> => {
  await ensureSchema(env);
  const conflicts: string[] = [];
  let upsertedSites = 0;
  let upsertedSimulations = 0;

  for (const site of payload.siteLibrary.slice(0, 4000)) {
    const result = await upsertOwnedResource(env, "site", actor, site);
    if (result.ok) upsertedSites += 1;
    else if (result.reason) conflicts.push(result.reason);
  }

  for (const simulation of payload.simulationPresets.slice(0, 4000)) {
    const result = await upsertOwnedResource(env, "simulation", actor, simulation);
    if (result.ok) upsertedSimulations += 1;
    else if (result.reason) conflicts.push(result.reason);
  }

  return { upsertedSites, upsertedSimulations, conflicts };
};

const canEditByRole = (role: string | null, visibility: Visibility, actorIsModerator: boolean): boolean => {
  if (role === "admin" || role === "editor") return true;
  if (visibility === "private") return false;
  if (actorIsModerator) return false;
  return false;
};

const userDisplayFallback = (name: string | null | undefined, userId: string | null | undefined): string => {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length) return trimmed;
  const id = typeof userId === "string" ? userId.trim() : "";
  if (!id) return "Unknown";
  return `User ${id.slice(0, 8)}`;
};

type LibraryRow = {
  payload_json: string;
  owner_user_id: string;
  owner_name: string | null;
  owner_avatar_url: string | null;
  visibility: DbVisibility;
  role: string | null;
  created_by_user_id: string | null;
  created_by_name: string | null;
  created_by_avatar_url: string | null;
  first_actor_user_id: string | null;
  first_actor_name: string | null;
  first_actor_avatar_url: string | null;
  last_edited_by_user_id: string | null;
  last_edited_by_name: string | null;
  last_edited_by_avatar_url: string | null;
  last_actor_user_id: string | null;
  last_actor_name: string | null;
  last_actor_avatar_url: string | null;
  created_at: string | null;
  last_edited_at: string | null;
};

export const fetchLibraryForUser = async (
  env: Env,
  userId: string,
  opts?: { since?: string },
): Promise<{ siteLibrary: CloudResourceRecord[]; simulationPresets: CloudResourceRecord[] }> => {
  await ensureSchema(env);
  const me = await fetchUserProfile(env, userId);
  const canReadAllResources = Boolean(me?.isAdmin);
  const actorIsModerator = Boolean(me?.isModerator);
  const siteRows = await env.DB
    .prepare(
      `SELECT s.payload_json, s.owner_user_id, s.visibility, r.role,
              owner_u.username AS owner_name,
              owner_u.avatar_url AS owner_avatar_url,
              s.created_by_user_id,
              (SELECT u.username FROM users u WHERE u.id = s.created_by_user_id) AS created_by_name,
              (SELECT u.avatar_url FROM users u WHERE u.id = s.created_by_user_id) AS created_by_avatar_url,
              (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'site' AND rc.resource_id = s.id ORDER BY rc.changed_at ASC LIMIT 1) AS first_actor_user_id,
              (SELECT u.username FROM users u WHERE u.id = (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'site' AND rc.resource_id = s.id ORDER BY rc.changed_at ASC LIMIT 1)) AS first_actor_name,
              (SELECT u.avatar_url FROM users u WHERE u.id = (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'site' AND rc.resource_id = s.id ORDER BY rc.changed_at ASC LIMIT 1)) AS first_actor_avatar_url,
              s.last_edited_by_user_id,
              (SELECT u.username FROM users u WHERE u.id = s.last_edited_by_user_id) AS last_edited_by_name,
              (SELECT u.avatar_url FROM users u WHERE u.id = s.last_edited_by_user_id) AS last_edited_by_avatar_url,
              (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'site' AND rc.resource_id = s.id ORDER BY rc.changed_at DESC LIMIT 1) AS last_actor_user_id,
              (SELECT u.username FROM users u WHERE u.id = (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'site' AND rc.resource_id = s.id ORDER BY rc.changed_at DESC LIMIT 1)) AS last_actor_name,
              (SELECT u.avatar_url FROM users u WHERE u.id = (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'site' AND rc.resource_id = s.id ORDER BY rc.changed_at DESC LIMIT 1)) AS last_actor_avatar_url,
              s.created_at,
              s.last_edited_at
       FROM sites s
       LEFT JOIN site_roles r ON r.site_id = s.id AND r.user_id = ?
       LEFT JOIN users owner_u ON owner_u.id = s.owner_user_id
       WHERE (? = 1
          OR s.owner_user_id = ?
          OR s.visibility IN ('public_read', 'public_write')
          OR (r.user_id IS NOT NULL AND s.visibility != 'private'))${opts?.since ? "\n          AND s.updated_at > ?" : ""}`,
    )
    .bind(userId, canReadAllResources ? 1 : 0, userId, ...(opts?.since ? [opts.since] : []))
    .all<LibraryRow>();

  const simulationRows = await env.DB
    .prepare(
      `SELECT s.payload_json, s.owner_user_id, s.visibility, r.role,
              owner_u.username AS owner_name,
              owner_u.avatar_url AS owner_avatar_url,
              s.created_by_user_id,
              (SELECT u.username FROM users u WHERE u.id = s.created_by_user_id) AS created_by_name,
              (SELECT u.avatar_url FROM users u WHERE u.id = s.created_by_user_id) AS created_by_avatar_url,
              (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'simulation' AND rc.resource_id = s.id ORDER BY rc.changed_at ASC LIMIT 1) AS first_actor_user_id,
              (SELECT u.username FROM users u WHERE u.id = (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'simulation' AND rc.resource_id = s.id ORDER BY rc.changed_at ASC LIMIT 1)) AS first_actor_name,
              (SELECT u.avatar_url FROM users u WHERE u.id = (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'simulation' AND rc.resource_id = s.id ORDER BY rc.changed_at ASC LIMIT 1)) AS first_actor_avatar_url,
              s.last_edited_by_user_id,
              (SELECT u.username FROM users u WHERE u.id = s.last_edited_by_user_id) AS last_edited_by_name,
              (SELECT u.avatar_url FROM users u WHERE u.id = s.last_edited_by_user_id) AS last_edited_by_avatar_url,
              (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'simulation' AND rc.resource_id = s.id ORDER BY rc.changed_at DESC LIMIT 1) AS last_actor_user_id,
              (SELECT u.username FROM users u WHERE u.id = (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'simulation' AND rc.resource_id = s.id ORDER BY rc.changed_at DESC LIMIT 1)) AS last_actor_name,
              (SELECT u.avatar_url FROM users u WHERE u.id = (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'simulation' AND rc.resource_id = s.id ORDER BY rc.changed_at DESC LIMIT 1)) AS last_actor_avatar_url,
              s.created_at,
              s.last_edited_at
       FROM simulations s
       LEFT JOIN simulation_roles r ON r.simulation_id = s.id AND r.user_id = ?
       LEFT JOIN users owner_u ON owner_u.id = s.owner_user_id
       WHERE (? = 1
          OR s.owner_user_id = ?
          OR s.visibility IN ('public_read', 'public_write')
          OR (r.user_id IS NOT NULL AND s.visibility != 'private'))${opts?.since ? "\n          AND s.updated_at > ?" : ""}`,
    )
    .bind(userId, canReadAllResources ? 1 : 0, userId, ...(opts?.since ? [opts.since] : []))
    .all<LibraryRow>();

  const mapRows = (rows: LibraryRow[]) =>
    rows
      .map((row) => {
        try {
          const parsed = JSON.parse(row.payload_json) as CloudResourceRecord;
          const createdByUserId = row.created_by_user_id ?? row.first_actor_user_id ?? row.owner_user_id;
          const createdByName = userDisplayFallback(
            row.created_by_name ?? row.first_actor_name ?? row.owner_name,
            createdByUserId ?? row.owner_user_id,
          );
          const createdByAvatarUrl =
            row.created_by_avatar_url ?? row.first_actor_avatar_url ?? row.owner_avatar_url ?? "";
          const lastEditedByUserId =
            row.last_edited_by_user_id ?? row.last_actor_user_id ?? createdByUserId ?? row.owner_user_id;
          const lastEditedByName = userDisplayFallback(
            row.last_edited_by_name ?? row.last_actor_name ?? createdByName ?? row.owner_name,
            lastEditedByUserId ?? createdByUserId ?? row.owner_user_id,
          );
          const lastEditedByAvatarUrl =
            row.last_edited_by_avatar_url ?? row.last_actor_avatar_url ?? createdByAvatarUrl ?? row.owner_avatar_url ?? "";
          return {
            ...parsed,
            ownerUserId: row.owner_user_id,
            visibility: visibilityFromDbVisibility(row.visibility),
            createdByUserId,
            createdByName,
            createdByAvatarUrl,
            createdAt: row.created_at,
            lastEditedByUserId,
            lastEditedByName,
            lastEditedByAvatarUrl,
            lastEditedAt: row.last_edited_at,
            effectiveRole:
              canReadAllResources
                ? "admin"
                : row.owner_user_id === userId
                ? "owner"
                : row.role ??
                  (canEditByRole(null, visibilityFromDbVisibility(row.visibility), actorIsModerator)
                    ? "editor"
                    : "viewer"),
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

export const backfillResourceMetadata = async (
  env: Env,
): Promise<{ sitesUpdated: number; simulationsUpdated: number }> => {
  await ensureSchema(env);

  const siteResult = await env.DB
    .prepare(
      `UPDATE sites
       SET created_by_user_id = COALESCE(
             created_by_user_id,
             (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'site' AND rc.resource_id = sites.id ORDER BY rc.changed_at ASC LIMIT 1),
             owner_user_id
           ),
           last_edited_by_user_id = COALESCE(
             last_edited_by_user_id,
             (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'site' AND rc.resource_id = sites.id ORDER BY rc.changed_at DESC LIMIT 1),
             created_by_user_id,
             owner_user_id
           ),
           created_at = COALESCE(
             created_at,
             (SELECT rc.changed_at FROM resource_changes rc WHERE rc.resource_kind = 'site' AND rc.resource_id = sites.id ORDER BY rc.changed_at ASC LIMIT 1),
             updated_at
           ),
           last_edited_at = COALESCE(
             last_edited_at,
             (SELECT rc.changed_at FROM resource_changes rc WHERE rc.resource_kind = 'site' AND rc.resource_id = sites.id ORDER BY rc.changed_at DESC LIMIT 1),
             updated_at
           )`,
    )
    .run();

  const simulationResult = await env.DB
    .prepare(
      `UPDATE simulations
       SET created_by_user_id = COALESCE(
             created_by_user_id,
             (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'simulation' AND rc.resource_id = simulations.id ORDER BY rc.changed_at ASC LIMIT 1),
             owner_user_id
           ),
           last_edited_by_user_id = COALESCE(
             last_edited_by_user_id,
             (SELECT rc.actor_user_id FROM resource_changes rc WHERE rc.resource_kind = 'simulation' AND rc.resource_id = simulations.id ORDER BY rc.changed_at DESC LIMIT 1),
             created_by_user_id,
             owner_user_id
           ),
           created_at = COALESCE(
             created_at,
             (SELECT rc.changed_at FROM resource_changes rc WHERE rc.resource_kind = 'simulation' AND rc.resource_id = simulations.id ORDER BY rc.changed_at ASC LIMIT 1),
             updated_at
           ),
           last_edited_at = COALESCE(
             last_edited_at,
             (SELECT rc.changed_at FROM resource_changes rc WHERE rc.resource_kind = 'simulation' AND rc.resource_id = simulations.id ORDER BY rc.changed_at DESC LIMIT 1),
             updated_at
           )`,
    )
    .run();

  return {
    sitesUpdated: Number((siteResult.meta as { changes?: number } | undefined)?.changes ?? 0),
    simulationsUpdated: Number((simulationResult.meta as { changes?: number } | undefined)?.changes ?? 0),
  };
};

export const reassignResourceOwner = async (
  env: Env,
  kind: "site" | "simulation",
  resourceId: string,
  newOwnerUserId: string,
  actorUserId: string,
): Promise<{ ok: boolean; previousOwnerUserId: string; newOwnerUserId: string }> => {
  await ensureSchema(env);
  const table = kind === "site" ? "sites" : "simulations";
  const existing = await env.DB
    .prepare(`SELECT owner_user_id FROM ${table} WHERE id = ? LIMIT 1`)
    .bind(resourceId)
    .first<{ owner_user_id: string }>();
  if (!existing?.owner_user_id) throw new Error("Resource not found.");

  const targetUser = await readUserRow(env, newOwnerUserId);
  if (!targetUser) throw new Error("New owner user not found.");

  const now = new Date().toISOString();
  await env.DB
    .prepare(
      `UPDATE ${table}
       SET owner_user_id = ?, last_edited_by_user_id = ?, last_edited_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(newOwnerUserId, actorUserId, now, now, resourceId)
    .run();

  await createResourceChange(
    env,
    kind,
    resourceId,
    "updated",
    actorUserId,
    `Ownership reassigned: ${existing.owner_user_id} -> ${newOwnerUserId}`,
  );
  await createAdminAuditEvent(
    env,
    "admin_reassign_resource_owner",
    actorUserId,
    { kind, resourceId, fromOwnerUserId: existing.owner_user_id, toOwnerUserId: newOwnerUserId },
    newOwnerUserId,
    existing.owner_user_id,
  );

  return {
    ok: true,
    previousOwnerUserId: existing.owner_user_id,
    newOwnerUserId,
  };
};

export const bulkReassignOwnership = async (
  env: Env,
  fromUserId: string,
  toUserId: string,
  actorUserId: string,
): Promise<{ sitesUpdated: number; simulationsUpdated: number }> => {
  await ensureSchema(env);
  if (fromUserId === toUserId) throw new Error("Source and target owner must differ.");
  const targetUser = await readUserRow(env, toUserId);
  if (!targetUser) throw new Error("Target owner user not found.");
  const now = new Date().toISOString();
  const sitesRes = await env.DB
    .prepare(
      `UPDATE sites
       SET owner_user_id = ?, last_edited_by_user_id = ?, last_edited_at = ?, updated_at = ?
       WHERE owner_user_id = ?`,
    )
    .bind(toUserId, actorUserId, now, now, fromUserId)
    .run();
  const simulationsRes = await env.DB
    .prepare(
      `UPDATE simulations
       SET owner_user_id = ?, last_edited_by_user_id = ?, last_edited_at = ?, updated_at = ?
       WHERE owner_user_id = ?`,
    )
    .bind(toUserId, actorUserId, now, now, fromUserId)
    .run();

  const sitesUpdated = Number((sitesRes.meta as { changes?: number } | undefined)?.changes ?? 0);
  const simulationsUpdated = Number((simulationsRes.meta as { changes?: number } | undefined)?.changes ?? 0);

  await createAdminAuditEvent(
    env,
    "admin_bulk_reassign_ownership",
    actorUserId,
    { fromUserId, toUserId, sitesUpdated, simulationsUpdated },
    toUserId,
    fromUserId,
  );

  return { sitesUpdated, simulationsUpdated };
};

export const listAdminAuditEvents = async (
  env: Env,
  limit = 120,
): Promise<
  Array<{
    id: number;
    eventType: string;
    targetUserId: string;
    sourceUserId: string | null;
    actorUserId: string | null;
    idpEmail: string | null;
    detailsJson: string | null;
    createdAt: string;
  }>
> => {
  await ensureSchema(env);
  const safeLimit = Math.max(1, Math.min(limit, 500));
  const rows = await env.DB
    .prepare(
      `SELECT id, event_type, target_user_id, source_user_id, actor_user_id, idp_email, details_json, created_at
       FROM user_identity_audit
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .bind(safeLimit)
    .all<{
      id: number;
      event_type: string;
      target_user_id: string;
      source_user_id: string | null;
      actor_user_id: string | null;
      idp_email: string | null;
      details_json: string | null;
      created_at: string;
    }>();
  return rows.results.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    targetUserId: row.target_user_id,
    sourceUserId: row.source_user_id,
    actorUserId: row.actor_user_id,
    idpEmail: row.idp_email,
    detailsJson: row.details_json,
    createdAt: row.created_at,
  }));
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
    details: Record<string, unknown> | null;
    snapshot: Record<string, unknown> | null;
  }>
> => {
  await ensureSchema(env);
  const rows = await env.DB
    .prepare(
      `SELECT c.id, c.action, c.changed_at, c.note, c.actor_user_id, c.details_json, c.snapshot_json,
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
      details_json: string | null;
      snapshot_json: string | null;
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
    details: row.details_json ? (JSON.parse(row.details_json) as Record<string, unknown>) : null,
    snapshot: row.snapshot_json ? (JSON.parse(row.snapshot_json) as Record<string, unknown>) : null,
  }));
};

export const revertResourceFromChangeCopy = async (
  env: Env,
  kind: "site" | "simulation",
  resourceId: string,
  changeId: number,
  actor: { id: string; isAdmin: boolean; isModerator?: boolean },
): Promise<{ ok: boolean; reason?: string }> => {
  await ensureSchema(env);
  const snapshotRow = await env.DB
    .prepare(
      `SELECT snapshot_json
       FROM resource_changes
       WHERE id = ? AND resource_kind = ? AND resource_id = ?
       LIMIT 1`,
    )
    .bind(changeId, kind, resourceId)
    .first<{ snapshot_json: string | null }>();
  if (!snapshotRow?.snapshot_json) return { ok: false, reason: "snapshot_missing" };

  let snapshot: CloudResourceRecord;
  try {
    snapshot = JSON.parse(snapshotRow.snapshot_json) as CloudResourceRecord;
  } catch {
    return { ok: false, reason: "snapshot_invalid" };
  }
  snapshot.id = resourceId;

  const result = await upsertOwnedResource(env, kind, {
    id: actor.id,
    isAdmin: actor.isAdmin,
    isModerator: Boolean(actor.isModerator),
  }, snapshot);
  if (!result.ok) return result;

  await createResourceChange(
    env,
    kind,
    resourceId,
    "updated",
    actor.id,
    `Revert copy from change #${changeId}`,
    {
      details: {
        revertedFromChangeId: changeId,
        mode: "copy",
      },
      snapshot: snapshot as Record<string, unknown>,
    },
  );
  return { ok: true };
};

export const resolveSimulationAccessForUser = async (
  env: Env,
  actor: { id: string; isAdmin: boolean; isModerator?: boolean },
  simulationId: string,
): Promise<"ok" | "forbidden" | "missing"> => {
  await ensureSchema(env);
  const id = simulationId.trim();
  if (!id) return "missing";

  const row = await env.DB
    .prepare(
      `SELECT s.owner_user_id, s.visibility, r.role AS actor_role
       FROM simulations s
       LEFT JOIN simulation_roles r ON r.simulation_id = s.id AND r.user_id = ?
       WHERE s.id = ?`,
    )
    .bind(actor.id, id)
    .first<{ owner_user_id: string; visibility: DbVisibility; actor_role?: string | null }>();

  if (!row) return "missing";

  const canRead = canReadResource(
    {
      id: actor.id,
      isAdmin: actor.isAdmin,
      isModerator: Boolean(actor.isModerator),
    },
    row.owner_user_id,
    visibilityFromDbVisibility(row.visibility),
    typeof row.actor_role === "string" ? row.actor_role : null,
  );

  return canRead ? "ok" : "forbidden";
};

export const resolveSimulationIdBySlug = async (
  env: Env,
  simulationSlug: string,
): Promise<string | null> => {
  await ensureSchema(env);
  const slug = slugifyName(simulationSlug);
  const canonicalKey = canonicalizeSimulationLookupKey(simulationSlug);
  if (!slug && !canonicalKey) return null;
  const rows = await env.DB
    .prepare("SELECT id, name, payload_json FROM simulations LIMIT 8000")
    .all<{ id: string; name: string; payload_json: string }>();
  for (const row of rows.results) {
    const nameSlug = slugifyName(row.name);
    if (slug && nameSlug === slug) return row.id;
    if (canonicalKey && canonicalizeSimulationLookupKey(row.name) === canonicalKey) return row.id;
    try {
      const payload = JSON.parse(row.payload_json) as { slug?: unknown; slugAliases?: unknown };
      const payloadSlugRaw = typeof payload.slug === "string" ? payload.slug : "";
      const payloadSlug = slugifyName(payloadSlugRaw);
      if (slug && payloadSlug && payloadSlug === slug) return row.id;
      if (canonicalKey && payloadSlugRaw && canonicalizeSimulationLookupKey(payloadSlugRaw) === canonicalKey) return row.id;
      const aliases = Array.isArray(payload.slugAliases)
        ? payload.slugAliases.filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0)
        : [];
      if (slug && aliases.some((alias) => slugifyName(alias) === slug)) return row.id;
      if (canonicalKey && aliases.some((alias) => canonicalizeSimulationLookupKey(alias) === canonicalKey)) return row.id;
    } catch {
      // ignore invalid payload rows
    }
  }
  return null;
};

export const resolveUserIdByUsernameSegment = async (env: Env, username: string): Promise<string | null> => {
  await ensureSchema(env);
  const slug = slugifyName(username);
  const canonicalKey = canonicalizeSimulationLookupKey(username);
  if (!slug && !canonicalKey) return null;
  const rows = await env.DB.prepare("SELECT id, username FROM users LIMIT 8000").all<{ id: string; username: string }>();
  for (const row of rows.results) {
    const name = row.username ?? "";
    if (slug && slugifyName(name) === slug) return row.id;
    if (canonicalKey && canonicalizeSimulationLookupKey(name) === canonicalKey) return row.id;
  }
  return null;
};

export const resolveSimulationIdByOwnerSlug = async (
  env: Env,
  username: string,
  simulationSlug: string,
): Promise<string | null> => {
  await ensureSchema(env);
  const ownerId = await resolveUserIdByUsernameSegment(env, username);
  if (!ownerId) return null;
  const slug = slugifyName(simulationSlug);
  const canonicalKey = canonicalizeSimulationLookupKey(simulationSlug);
  if (!slug && !canonicalKey) return null;
  const rows = await env.DB
    .prepare("SELECT id, name, payload_json FROM simulations WHERE owner_user_id = ? LIMIT 8000")
    .bind(ownerId)
    .all<{ id: string; name: string; payload_json: string }>();
  for (const row of rows.results) {
    const nameSlug = slugifyName(row.name);
    if (slug && nameSlug === slug) return row.id;
    if (canonicalKey && canonicalizeSimulationLookupKey(row.name) === canonicalKey) return row.id;
    try {
      const payload = JSON.parse(row.payload_json) as { slug?: unknown; slugAliases?: unknown };
      const payloadSlugRaw = typeof payload.slug === "string" ? payload.slug : "";
      const payloadSlug = slugifyName(payloadSlugRaw);
      if (slug && payloadSlug && payloadSlug === slug) return row.id;
      if (canonicalKey && payloadSlugRaw && canonicalizeSimulationLookupKey(payloadSlugRaw) === canonicalKey) return row.id;
      const aliases = Array.isArray(payload.slugAliases)
        ? payload.slugAliases.filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0)
        : [];
      if (slug && aliases.some((alias) => slugifyName(alias) === slug)) return row.id;
      if (canonicalKey && aliases.some((alias) => canonicalizeSimulationLookupKey(alias) === canonicalKey)) return row.id;
    } catch {
      // ignore invalid payload rows
    }
  }
  return null;
};

export const fetchPublicSimulationBundle = async (
  env: Env,
  options: { simulationId?: string; username?: string; simulationSlug?: string; actorId?: string | null },
): Promise<
  | { status: "missing" | "forbidden" }
  | {
      status: "ok";
      simulationId: string;
      simulation: CloudResourceRecord;
      sites: CloudResourceRecord[];
    }
> => {
  await ensureSchema(env);
  const resolvedId =
    (options.simulationId && options.simulationId.trim()) ||
    (options.username && options.simulationSlug
      ? await resolveSimulationIdByOwnerSlug(env, options.username, options.simulationSlug)
      : null);
  if (!resolvedId) return { status: "missing" };

  const simulationRow = await env.DB
    .prepare("SELECT id, payload_json, visibility FROM simulations WHERE id = ? LIMIT 1")
    .bind(resolvedId)
    .first<{ id: string; payload_json: string; visibility: DbVisibility }>();
  if (!simulationRow) return { status: "missing" };
  const visibility = visibilityFromDbVisibility(simulationRow.visibility);

  let actorSimulationRole: string | null = null;
  if (visibility === "private") {
    if (!options.actorId) return { status: "forbidden" };
    const roleRow = await env.DB
      .prepare("SELECT role FROM simulation_roles WHERE simulation_id = ? AND user_id = ? LIMIT 1")
      .bind(resolvedId, options.actorId)
      .first<{ role: string }>();
    if (!roleRow) return { status: "forbidden" };
    actorSimulationRole = roleRow.role;
  }

  let simulation: CloudResourceRecord;
  try {
    simulation = JSON.parse(simulationRow.payload_json) as CloudResourceRecord;
  } catch {
    return { status: "missing" };
  }
  simulation.id = simulationRow.id;
  simulation.visibility = visibility;
  simulation.effectiveRole = actorSimulationRole ?? "viewer";

  const referencedSiteIds = referencedLibrarySiteIdsFromSimulation(simulation);
  if (!referencedSiteIds.length) {
    return {
      status: "ok",
      simulationId: simulationRow.id,
      simulation,
      sites: [],
    };
  }

  const placeholders = referencedSiteIds.map(() => "?").join(",");
  const rows = await env.DB
    .prepare(`SELECT id, payload_json, visibility FROM sites WHERE id IN (${placeholders})`)
    .bind(...referencedSiteIds)
    .all<{ id: string; payload_json: string; visibility: DbVisibility }>();
  const sites: CloudResourceRecord[] = [];
  for (const row of rows.results) {
    // When actor has an explicit simulation role (private access), include all referenced
    // sites regardless of their individual visibility — simulation-level access covers its sites.
    if (actorSimulationRole === null && visibilityFromDbVisibility(row.visibility) === "private") continue;
    try {
      const site = JSON.parse(row.payload_json) as CloudResourceRecord;
      site.id = row.id;
      site.visibility = visibilityFromDbVisibility(row.visibility);
      site.effectiveRole = "viewer";
      sites.push(site);
    } catch {
      // ignore invalid row
    }
  }
  return {
    status: "ok",
    simulationId: simulationRow.id,
    simulation,
    sites,
  };
};
