import type { CloudResourceRecord, DbVisibility, Env, Grant, ResourceRole, UserRole, Visibility } from "./types";
import { findPresetById } from "../../src/lib/frequencyPlans";
import {
  normalizeUserSimulationDefaultsPreference,
  type UserSimulationDefaultsPreference,
} from "../../src/lib/simulationDefaults";
import {
  LIBRARY_BATCH_MAX_RECORDS,
  LIBRARY_MAX_GRANTS,
  LIBRARY_MAX_PUBLIC_SIMULATIONS_PER_USER,
  LIBRARY_MAX_PUBLIC_SITES_PER_USER,
  LIBRARY_MAX_SIMULATIONS_PER_USER,
  LIBRARY_MAX_SITES_PER_USER,
  LIBRARY_SIMULATION_MAX_BYTES,
  LIBRARY_SITE_MAX_BYTES,
  LibraryValidationError,
} from "../../src/lib/libraryLimits";

const VISIBILITIES: Visibility[] = ["private", "public", "shared"];
const DB_VISIBILITIES: DbVisibility[] = ["private", "public_read", "public_write"];
const ROLES: ResourceRole[] = ["viewer", "editor", "admin"];

let schemaReady: Promise<void> | null = null;
const SCHEMA_VERSION = "2026-08-12-identity-lifecycle-v1";
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

type ResourceChangeDiffValue = { before: unknown; after: unknown };

const isDisplayableResourceChangeValue = (field: string, value: unknown): boolean => {
  if (field === "name") return typeof value === "string";
  if (field === "visibility") return typeof value === "string" && VISIBILITIES.includes(value as Visibility);
  if (field === "status") return value === "active" || value === "deleted";
  return false;
};

const readDisplayableChangeDetails = (
  detailsJson: string | null,
): { diff: Record<string, ResourceChangeDiffValue> } | null => {
  if (!detailsJson) return null;
  try {
    const details = JSON.parse(detailsJson) as { diff?: unknown };
    if (!details.diff || typeof details.diff !== "object" || Array.isArray(details.diff)) return null;
    const diff: Record<string, ResourceChangeDiffValue> = {};
    for (const [field, value] of Object.entries(details.diff as Record<string, unknown>)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const { before, after } = value as { before?: unknown; after?: unknown };
      if (!isDisplayableResourceChangeValue(field, before) || !isDisplayableResourceChangeValue(field, after)) continue;
      diff[field] = { before, after };
    }
    return Object.keys(diff).length ? { diff } : null;
  } catch {
    return null;
  }
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

const sanitizeSimulationDefaultsPreference = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Simulation defaults preference must be an object or null.");
  const raw = value as UserSimulationDefaultsPreference;
  const normalized = normalizeUserSimulationDefaultsPreference(raw);
  return JSON.stringify(normalized);
};

const deriveDefaultEmail = (userId: string, tokenPayload?: Record<string, unknown>): string => {
  const fromEmail = sanitizeEmail(tokenPayload?.email);
  if (fromEmail) return fromEmail;
  const fromUserId = sanitizeEmail(userId);
  if (fromUserId) return fromUserId;
  return `${userId.slice(0, 12)}@users.linksim.local`;
};

const deriveVerifiedIdpEmail = (tokenPayload?: Record<string, unknown>): string => {
  const fromPayload = sanitizeEmail(tokenPayload?.__linksim_verified_idp_email);
  return fromPayload ?? "";
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
  deleted_users: ["id", "deleted_at", "deleted_by_user_id"],
  verified_identity_claims: [
    "normalized_email",
    "current_user_id",
    "status",
    "created_at",
    "updated_at",
    "blocked_at",
    "blocked_by_user_id",
  ],
  identity_subject_states: [
    "user_id",
    "normalized_email",
    "status",
    "canonical_user_id",
    "bootstrap_consumed",
    "created_at",
    "updated_at",
    "changed_by_user_id",
  ],
  identity_lifecycle_meta: ["singleton", "version", "applied_at"],
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
  if (!missing.some((entry) => entry.table === "identity_lifecycle_meta")) {
    const marker = await env.DB
      .prepare("SELECT version FROM identity_lifecycle_meta WHERE singleton = 1 LIMIT 1")
      .first<{ version: string }>();
    if (marker?.version !== SCHEMA_VERSION) {
      missing.push({ table: "identity_lifecycle_meta", columns: [`version=${SCHEMA_VERSION}`] });
    }
  }
  return { version: SCHEMA_VERSION, ok: missing.length === 0, missing };
};

const ensureSchema = async (env: Env): Promise<void> => {
  if (!schemaReady) {
    schemaReady = (async () => {
      // Identity lifecycle state must be migrated before runtime performs any
      // schema creation, backfill, or account mutation. In particular, never
      // create an empty claims table that would bypass the required backfill.
      const identityMetaInfo = await env.DB
        .prepare("PRAGMA table_info(identity_lifecycle_meta)")
        .all<{ name: string }>();
      const identityMetaColumns = new Set(identityMetaInfo.results.map((column) => column.name));
      if (!["singleton", "version", "applied_at"].every((column) => identityMetaColumns.has(column))) {
        throw new Error("Schema out of date. Run the identity lifecycle D1 migration before serving requests.");
      }
      const identityMarker = await env.DB
        .prepare("SELECT version FROM identity_lifecycle_meta WHERE singleton = 1 LIMIT 1")
        .first<{ version: string }>();
      if (identityMarker?.version !== SCHEMA_VERSION) {
        throw new Error("Schema out of date. Identity lifecycle migration marker is missing or outdated.");
      }

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
            simulation_defaults_preference_json TEXT,
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
            status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
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
            PRIMARY KEY (simulation_id, canonical_path_key),
            FOREIGN KEY (simulation_id) REFERENCES simulations(id) ON DELETE CASCADE,
            FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
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
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_simulations_status ON simulations(status)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_simulation_roles_user ON simulation_roles(user_id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_resource_changes_lookup ON resource_changes(resource_kind, resource_id, changed_at DESC)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_path_leaderboard_distance ON simulation_path_leaderboard_entries(distance_km DESC)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_path_leaderboard_simulation ON simulation_path_leaderboard_entries(simulation_id)"),
        env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_identity_audit_target ON user_identity_audit(target_user_id, created_at DESC)"),
      ]);

      // Backfill additive user columns for existing databases before strict diagnostics.
      const userTableInfo = await env.DB.prepare("PRAGMA table_info(users)").all<{ name: string }>();
      const userColumns = new Set(userTableInfo.results.map((column) => column.name));
      if (!userColumns.has("default_frequency_preset_id")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN default_frequency_preset_id TEXT").run();
      }
      if (!userColumns.has("simulation_defaults_preference_json")) {
        await env.DB.prepare("ALTER TABLE users ADD COLUMN simulation_defaults_preference_json TEXT").run();
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
  simulation_defaults_preference_json: string | null;
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

type VerifiedIdentityEnsureInput = {
  userId: string;
  email: string;
  defaultEmail: string;
  bootstrapAdmin: boolean;
  now: string;
};

type SerializedIdentityLocation =
  | { table: "sites" | "simulations"; column: "payload_json"; bumpTimestamp: true }
  | { table: "resource_changes"; column: "snapshot_json"; bumpTimestamp: false };

const prepareSerializedGrantIdentityMigration = (
  env: Pick<Env, "DB">,
  location: SerializedIdentityLocation,
  normalizedEmail: string,
  targetUserId: string,
  now: string,
): D1PreparedStatement => {
  const timestampAssignment = location.bumpTimestamp ? ", updated_at = ?3" : "";
  return env.DB
    .prepare(
      `WITH identity_source AS (
         SELECT current_user_id AS id
         FROM verified_identity_claims
         WHERE normalized_email = ?1 AND status = 'active'
       )
       UPDATE ${location.table}
       SET ${location.column} = json_set(
         ${location.column},
         '$.sharedWith',
         json((
           SELECT json_group_array(
             json_object(
               'userId', migrated_user_id,
               'role', CASE strongest_role WHEN 2 THEN 'admin' WHEN 1 THEN 'editor' ELSE 'viewer' END
             )
           )
           FROM (
             SELECT
               CASE WHEN user_id = (SELECT id FROM identity_source) THEN ?2 ELSE user_id END AS migrated_user_id,
               MAX(role_strength) AS strongest_role
             FROM (
               SELECT
                 CASE WHEN j.type = 'object' THEN trim(json_extract(j.value, '$.userId')) ELSE '' END AS user_id,
                 CASE json_extract(j.value, '$.role')
                   WHEN 'admin' THEN 2 WHEN 'editor' THEN 1 WHEN 'viewer' THEN 0 ELSE -1
                 END AS role_strength
               FROM json_each(${location.column}, '$.sharedWith') AS j
             ) serialized_grants
             WHERE user_id <> '' AND role_strength >= 0
             GROUP BY CASE WHEN user_id = (SELECT id FROM identity_source) THEN ?2 ELSE user_id END
           ) migrated_grants
         )))${timestampAssignment}
       WHERE json_valid(${location.column})
         AND (SELECT id FROM identity_source) <> ?2
         AND EXISTS (SELECT 1 FROM users WHERE id = ?2)
         AND EXISTS (
           SELECT 1
           FROM json_each(${location.column}, '$.sharedWith') AS j
           WHERE j.type = 'object'
             AND trim(json_extract(j.value, '$.userId')) = (SELECT id FROM identity_source)
         )`,
    )
    .bind(...(location.bumpTimestamp ? [normalizedEmail, targetUserId, now] : [normalizedEmail, targetUserId]));
};

const prepareSerializedMetadataIdentityMigration = (
  env: Pick<Env, "DB">,
  location: SerializedIdentityLocation,
  normalizedEmail: string,
  targetUserId: string,
  now: string,
): D1PreparedStatement => {
  const timestampAssignment = location.bumpTimestamp ? ", updated_at = ?3" : "";
  return env.DB
    .prepare(
      `WITH identity_source AS (
         SELECT current_user_id AS id
         FROM verified_identity_claims
         WHERE normalized_email = ?1 AND status = 'active'
       ),
       candidates AS MATERIALIZED (
         SELECT rowid AS target_rowid, ${location.column} AS migrated_json
         FROM ${location.table}
         WHERE json_valid(${location.column})
           AND (SELECT id FROM identity_source) <> ?2
           AND EXISTS (SELECT 1 FROM users WHERE id = ?2)
           AND (
             trim(json_extract(${location.column}, '$.ownerUserId')) = (SELECT id FROM identity_source)
             OR trim(json_extract(${location.column}, '$.createdByUserId')) = (SELECT id FROM identity_source)
             OR trim(json_extract(${location.column}, '$.lastEditedByUserId')) = (SELECT id FROM identity_source)
           )
       ),
       owners AS (
         SELECT target_rowid,
                CASE WHEN trim(json_extract(migrated_json, '$.ownerUserId')) = (SELECT id FROM identity_source)
                  THEN json_set(migrated_json, '$.ownerUserId', ?2) ELSE migrated_json END AS migrated_json
         FROM candidates
       ),
       creators AS (
         SELECT target_rowid,
                CASE WHEN trim(json_extract(migrated_json, '$.createdByUserId')) = (SELECT id FROM identity_source)
                  THEN json_set(migrated_json, '$.createdByUserId', ?2) ELSE migrated_json END AS migrated_json
         FROM owners
       ),
       editors AS (
         SELECT target_rowid,
                CASE WHEN trim(json_extract(migrated_json, '$.lastEditedByUserId')) = (SELECT id FROM identity_source)
                  THEN json_set(migrated_json, '$.lastEditedByUserId', ?2) ELSE migrated_json END AS migrated_json
         FROM creators
       )
       UPDATE ${location.table}
       SET ${location.column} = (
         SELECT migrated_json FROM editors WHERE target_rowid = ${location.table}.rowid
       )${timestampAssignment}
       WHERE rowid IN (SELECT target_rowid FROM editors)`,
    )
    .bind(...(location.bumpTimestamp ? [normalizedEmail, targetUserId, now] : [normalizedEmail, targetUserId]));
};

const readVerifiedIdentityCommandState = async (
  env: Pick<Env, "DB">,
  userId: string,
  normalizedEmail: string,
): Promise<{ claim_status: string | null; current_user_id: string | null; subject_status: string | null; deleted_at: string | null }> =>
  (await env.DB
    .prepare(
      `SELECT claim.status AS claim_status,
              claim.current_user_id,
              subject.status AS subject_status,
              tombstone.deleted_at
       FROM (SELECT 1) seed
       LEFT JOIN verified_identity_claims claim ON claim.normalized_email = ?
       LEFT JOIN identity_subject_states subject ON subject.user_id = ?
       LEFT JOIN deleted_users tombstone ON tombstone.id = ?`,
    )
    .bind(normalizedEmail, userId, userId)
    .first<{
      claim_status: string | null;
      current_user_id: string | null;
      subject_status: string | null;
      deleted_at: string | null;
    }>()) ?? { claim_status: null, current_user_id: null, subject_status: null, deleted_at: null };

export const executeVerifiedIdentityEnsure = async (
  env: Pick<Env, "DB">,
  input: VerifiedIdentityEnsureInput,
): Promise<void> => {
  const { userId, email: normalizedEmail, defaultEmail, bootstrapAdmin, now } = input;
  const activeSourceSql = `SELECT current_user_id FROM verified_identity_claims
                           WHERE normalized_email = ? AND status = 'active'`;
  const sourceDiffersSql = `(${activeSourceSql}) <> ? AND EXISTS (SELECT 1 FROM users WHERE id = ?)`;
  const targetAllowedSql = `NOT EXISTS (
      SELECT 1 FROM identity_subject_states
      WHERE user_id = ? AND status IN ('superseded', 'blocked')
    ) AND NOT EXISTS (SELECT 1 FROM deleted_users WHERE id = ?)`;

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO verified_identity_claims
          (normalized_email, current_user_id, status, created_at, updated_at, blocked_at, blocked_by_user_id)
         SELECT ?, ?, 'active', ?, ?, NULL, NULL
         WHERE ${targetAllowedSql}
         ON CONFLICT(normalized_email) DO NOTHING`,
      )
      .bind(normalizedEmail, userId, now, now, userId, userId),
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO users
          (id, username, email, username_set_at, bio, access_request_note, idp_email, idp_email_verified,
           avatar_url, email_public, avatar_object_key, avatar_thumb_key, avatar_hash, avatar_bytes,
           avatar_content_type, is_admin, is_moderator, is_approved, approved_at, approved_by_user_id,
           created_at, updated_at)
         SELECT ?, '', ?, NULL, '', '', ?, 1, '', 1, NULL, NULL, NULL, NULL, NULL,
                CASE WHEN ? = 1
                  AND (SELECT current_user_id FROM verified_identity_claims
                       WHERE normalized_email = ? AND status = 'active') = ?
                  AND NOT EXISTS (
                  SELECT 1 FROM identity_subject_states WHERE user_id = ? AND bootstrap_consumed = 1
                ) THEN 1 ELSE 0 END,
                0, 1, ?, 'system:open-registration', ?, ?
         WHERE EXISTS (
           SELECT 1 FROM verified_identity_claims
           WHERE normalized_email = ? AND status = 'active'
         ) AND ${targetAllowedSql}`,
      )
      .bind(
        userId,
        defaultEmail,
        normalizedEmail,
        bootstrapAdmin ? 1 : 0,
        normalizedEmail,
        userId,
        userId,
        now,
        now,
        now,
        normalizedEmail,
        userId,
        userId,
      ),
    env.DB
      .prepare(
        `INSERT INTO identity_lifecycle_meta (singleton, version, applied_at)
         SELECT singleton, version, applied_at
         FROM identity_lifecycle_meta
         WHERE singleton = 1
           AND EXISTS (
             SELECT 1
             FROM simulations source_simulation
             JOIN simulations target_simulation
               ON lower(target_simulation.name) = lower(source_simulation.name)
             WHERE source_simulation.owner_user_id = (${activeSourceSql})
               AND target_simulation.owner_user_id = ?
               AND source_simulation.owner_user_id <> target_simulation.owner_user_id
               AND source_simulation.status = 'active'
               AND target_simulation.status = 'active'
           )`,
      )
      .bind(normalizedEmail, userId),
    env.DB
      .prepare(
        `UPDATE users AS target
         SET username = source.username,
             email = source.email,
             username_set_at = source.username_set_at,
             bio = source.bio,
             access_request_note = source.access_request_note,
             avatar_url = source.avatar_url,
             email_public = source.email_public,
             default_frequency_preset_id = source.default_frequency_preset_id,
             simulation_defaults_preference_json = source.simulation_defaults_preference_json,
             avatar_object_key = source.avatar_object_key,
             avatar_thumb_key = source.avatar_thumb_key,
             avatar_hash = source.avatar_hash,
             avatar_bytes = source.avatar_bytes,
             avatar_content_type = source.avatar_content_type,
             created_at = source.created_at,
             is_admin = source.is_admin,
             is_moderator = source.is_moderator,
             is_approved = source.is_approved,
             approved_at = source.approved_at,
             approved_by_user_id = source.approved_by_user_id,
             updated_at = ?
         FROM users source
         WHERE target.id = ?
           AND source.id = (${activeSourceSql})
           AND source.id <> ?`,
      )
      .bind(now, userId, normalizedEmail, userId),
    env.DB
      .prepare(
        `UPDATE sites
         SET owner_user_id = ?, updated_at = ?
         WHERE owner_user_id = (${activeSourceSql}) AND ${sourceDiffersSql}`,
      )
      .bind(userId, now, normalizedEmail, normalizedEmail, userId, userId),
    env.DB
      .prepare(
        `UPDATE sites
         SET created_by_user_id = CASE WHEN created_by_user_id = (${activeSourceSql}) THEN ? ELSE created_by_user_id END,
             last_edited_by_user_id = CASE WHEN last_edited_by_user_id = (${activeSourceSql}) THEN ? ELSE last_edited_by_user_id END,
             updated_at = ?
         WHERE ${sourceDiffersSql}
           AND (created_by_user_id = (${activeSourceSql}) OR last_edited_by_user_id = (${activeSourceSql}))`,
      )
      .bind(normalizedEmail, userId, normalizedEmail, userId, now, normalizedEmail, userId, userId, normalizedEmail, normalizedEmail),
    env.DB
      .prepare(
        `UPDATE simulations
         SET owner_user_id = ?, updated_at = ?
         WHERE owner_user_id = (${activeSourceSql}) AND ${sourceDiffersSql}`,
      )
      .bind(userId, now, normalizedEmail, normalizedEmail, userId, userId),
    env.DB
      .prepare(
        `UPDATE simulations
         SET created_by_user_id = CASE WHEN created_by_user_id = (${activeSourceSql}) THEN ? ELSE created_by_user_id END,
             last_edited_by_user_id = CASE WHEN last_edited_by_user_id = (${activeSourceSql}) THEN ? ELSE last_edited_by_user_id END,
             updated_at = ?
         WHERE ${sourceDiffersSql}
           AND (created_by_user_id = (${activeSourceSql}) OR last_edited_by_user_id = (${activeSourceSql}))`,
      )
      .bind(normalizedEmail, userId, normalizedEmail, userId, now, normalizedEmail, userId, userId, normalizedEmail, normalizedEmail),
    env.DB
      .prepare(
        `INSERT INTO site_roles (site_id, user_id, role, created_at)
         SELECT site_id, ?, role, created_at
         FROM site_roles
         WHERE user_id = (${activeSourceSql}) AND ${sourceDiffersSql}
         ON CONFLICT(site_id, user_id) DO UPDATE SET role = CASE
           WHEN excluded.role = 'admin' OR site_roles.role = 'admin' THEN 'admin'
           WHEN excluded.role = 'editor' OR site_roles.role = 'editor' THEN 'editor'
           ELSE 'viewer' END`,
      )
      .bind(userId, normalizedEmail, normalizedEmail, userId, userId),
    env.DB
      .prepare(
        `UPDATE sites SET updated_at = ?
         WHERE id IN (SELECT site_id FROM site_roles WHERE user_id = (${activeSourceSql}))
           AND ${sourceDiffersSql}`,
      )
      .bind(now, normalizedEmail, normalizedEmail, userId, userId),
    env.DB
      .prepare(`DELETE FROM site_roles WHERE user_id = (${activeSourceSql}) AND ${sourceDiffersSql}`)
      .bind(normalizedEmail, normalizedEmail, userId, userId),
    env.DB
      .prepare(
        `INSERT INTO simulation_roles (simulation_id, user_id, role, created_at)
         SELECT simulation_id, ?, role, created_at
         FROM simulation_roles
         WHERE user_id = (${activeSourceSql}) AND ${sourceDiffersSql}
         ON CONFLICT(simulation_id, user_id) DO UPDATE SET role = CASE
           WHEN excluded.role = 'admin' OR simulation_roles.role = 'admin' THEN 'admin'
           WHEN excluded.role = 'editor' OR simulation_roles.role = 'editor' THEN 'editor'
           ELSE 'viewer' END`,
      )
      .bind(userId, normalizedEmail, normalizedEmail, userId, userId),
    env.DB
      .prepare(
        `UPDATE simulations SET updated_at = ?
         WHERE id IN (SELECT simulation_id FROM simulation_roles WHERE user_id = (${activeSourceSql}))
           AND ${sourceDiffersSql}`,
      )
      .bind(now, normalizedEmail, normalizedEmail, userId, userId),
    env.DB
      .prepare(`DELETE FROM simulation_roles WHERE user_id = (${activeSourceSql}) AND ${sourceDiffersSql}`)
      .bind(normalizedEmail, normalizedEmail, userId, userId),
    prepareSerializedGrantIdentityMigration(
      env,
      { table: "sites", column: "payload_json", bumpTimestamp: true },
      normalizedEmail,
      userId,
      now,
    ),
    prepareSerializedGrantIdentityMigration(
      env,
      { table: "simulations", column: "payload_json", bumpTimestamp: true },
      normalizedEmail,
      userId,
      now,
    ),
    prepareSerializedGrantIdentityMigration(
      env,
      { table: "resource_changes", column: "snapshot_json", bumpTimestamp: false },
      normalizedEmail,
      userId,
      now,
    ),
    prepareSerializedMetadataIdentityMigration(
      env,
      { table: "sites", column: "payload_json", bumpTimestamp: true },
      normalizedEmail,
      userId,
      now,
    ),
    prepareSerializedMetadataIdentityMigration(
      env,
      { table: "simulations", column: "payload_json", bumpTimestamp: true },
      normalizedEmail,
      userId,
      now,
    ),
    prepareSerializedMetadataIdentityMigration(
      env,
      { table: "resource_changes", column: "snapshot_json", bumpTimestamp: false },
      normalizedEmail,
      userId,
      now,
    ),
    env.DB
      .prepare(`UPDATE resource_changes SET actor_user_id = ? WHERE actor_user_id = (${activeSourceSql}) AND ${sourceDiffersSql}`)
      .bind(userId, normalizedEmail, normalizedEmail, userId, userId),
    env.DB
      .prepare(`UPDATE simulation_path_leaderboard_entries SET owner_user_id = ? WHERE owner_user_id = (${activeSourceSql}) AND ${sourceDiffersSql}`)
      .bind(userId, normalizedEmail, normalizedEmail, userId, userId),
    env.DB
      .prepare(`UPDATE users SET approved_by_user_id = ? WHERE approved_by_user_id = (${activeSourceSql}) AND ${sourceDiffersSql}`)
      .bind(userId, normalizedEmail, normalizedEmail, userId, userId),
    env.DB
      .prepare(
        `INSERT INTO user_identity_audit
          (event_type, target_user_id, source_user_id, actor_user_id, idp_email, details_json, created_at)
         SELECT 'reconciled_by_verified_idp_email', ?, source.id, ?, ?,
                json_object(
                  'mergedFromUserId', source.id,
                  'mergedFromIsAdmin', json(CASE WHEN source.is_admin = 1 THEN 'true' ELSE 'false' END),
                  'mergedFromIsModerator', json(CASE WHEN source.is_moderator = 1 THEN 'true' ELSE 'false' END),
                  'mergedFromIsApproved', json(CASE WHEN source.is_approved = 1 THEN 'true' ELSE 'false' END)
                ), ?
         FROM users source
         WHERE source.id = (${activeSourceSql}) AND source.id <> ?
           AND EXISTS (SELECT 1 FROM users WHERE id = ?)`,
      )
      .bind(userId, userId, normalizedEmail, now, normalizedEmail, userId, userId),
    env.DB
      .prepare(
        `UPDATE identity_subject_states
         SET canonical_user_id = ?, updated_at = ?, changed_by_user_id = ?
         WHERE status = 'superseded'
           AND canonical_user_id = (${activeSourceSql})
           AND ${sourceDiffersSql}`,
      )
      .bind(userId, now, userId, normalizedEmail, normalizedEmail, userId, userId),
    env.DB
      .prepare(
        `INSERT INTO identity_subject_states
          (user_id, normalized_email, status, canonical_user_id, bootstrap_consumed, created_at, updated_at, changed_by_user_id)
         SELECT current_user_id, normalized_email, 'superseded', ?, 1, ?, ?, ?
         FROM verified_identity_claims
         WHERE normalized_email = ? AND status = 'active' AND current_user_id <> ?
           AND EXISTS (SELECT 1 FROM users WHERE id = ?)
         ON CONFLICT(user_id) DO UPDATE SET
           normalized_email = excluded.normalized_email,
           status = 'superseded',
           canonical_user_id = excluded.canonical_user_id,
           updated_at = excluded.updated_at,
           changed_by_user_id = excluded.changed_by_user_id`,
      )
      .bind(userId, now, now, userId, normalizedEmail, userId, userId),
    env.DB
      .prepare(`DELETE FROM users WHERE id = (${activeSourceSql}) AND ${sourceDiffersSql}`)
      .bind(normalizedEmail, normalizedEmail, userId, userId),
    env.DB
      .prepare(
        `WITH identity_source(id) AS MATERIALIZED (
           SELECT current_user_id FROM verified_identity_claims
           WHERE normalized_email = ? AND status = 'active'
         )
         UPDATE verified_identity_claims
         SET current_user_id = ?, updated_at = ?
         WHERE status = 'active'
           AND current_user_id = (SELECT id FROM identity_source)
           AND EXISTS (SELECT 1 FROM users WHERE id = ?)`,
      )
      .bind(normalizedEmail, userId, now, userId),
    env.DB
      .prepare(
        `INSERT INTO identity_subject_states
          (user_id, normalized_email, status, canonical_user_id, bootstrap_consumed, created_at, updated_at, changed_by_user_id)
         SELECT ?, ?, 'current', ?, 1, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM verified_identity_claims
           WHERE normalized_email = ? AND status = 'active' AND current_user_id = ?
         ) AND ${targetAllowedSql}
         ON CONFLICT(user_id) DO UPDATE SET
           normalized_email = excluded.normalized_email,
           canonical_user_id = excluded.canonical_user_id,
           bootstrap_consumed = 1,
           updated_at = excluded.updated_at,
           changed_by_user_id = excluded.changed_by_user_id
         WHERE identity_subject_states.status = 'current'`,
      )
      .bind(userId, normalizedEmail, userId, now, now, userId, normalizedEmail, userId, userId, userId),
    env.DB
      .prepare(
        `UPDATE users
         SET email = COALESCE(NULLIF(TRIM(email), ''), ?),
             idp_email = ?, idp_email_verified = 1, updated_at = ?
         WHERE id = ?
           AND EXISTS (
             SELECT 1 FROM verified_identity_claims claim
             JOIN identity_subject_states subject ON subject.user_id = ?
             WHERE claim.normalized_email = ? AND claim.status = 'active'
               AND claim.current_user_id = ? AND subject.status = 'current'
           )`,
      )
      .bind(defaultEmail, normalizedEmail, now, userId, userId, normalizedEmail, userId),
  ]);

  const state = await readVerifiedIdentityCommandState(env, userId, normalizedEmail);
  if (state.subject_status === "superseded") throw new Error("Identity subject is no longer current");
  if (state.deleted_at || state.subject_status === "blocked" || state.claim_status === "blocked") {
    throw new Error("Identity is blocked by an administrator");
  }
  if (state.claim_status !== "active" || state.current_user_id !== userId || state.subject_status !== "current") {
    throw new Error("Verified identity lifecycle invariant failed");
  }
};

export const executeUnverifiedIdentityEnsure = async (
  env: Pick<Env, "DB">,
  input: { userId: string; defaultEmail: string; bootstrapAdmin: boolean; now: string },
): Promise<void> => {
  const { userId, defaultEmail, bootstrapAdmin, now } = input;
  const allowedSql = `NOT EXISTS (
      SELECT 1 FROM identity_subject_states
      WHERE user_id = ? AND status IN ('superseded', 'blocked')
    ) AND NOT EXISTS (SELECT 1 FROM deleted_users WHERE id = ?)`;
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO users
          (id, username, email, username_set_at, bio, access_request_note, idp_email, idp_email_verified,
           avatar_url, email_public, avatar_object_key, avatar_thumb_key, avatar_hash, avatar_bytes,
           avatar_content_type, is_admin, is_moderator, is_approved, approved_at, approved_by_user_id,
           created_at, updated_at)
         SELECT ?, '', ?, NULL, '', '', NULL, 0, '', 1, NULL, NULL, NULL, NULL, NULL,
                CASE WHEN ? = 1 AND NOT EXISTS (
                  SELECT 1 FROM identity_subject_states WHERE user_id = ? AND bootstrap_consumed = 1
                ) THEN 1 ELSE 0 END,
                0, 1, ?, 'system:open-registration', ?, ?
         WHERE ${allowedSql}`,
      )
      .bind(userId, defaultEmail, bootstrapAdmin ? 1 : 0, userId, now, now, now, userId, userId),
    env.DB
      .prepare(
        `UPDATE users
         SET email = COALESCE(NULLIF(TRIM(email), ''), ?), updated_at = ?
         WHERE id = ? AND ${allowedSql}`,
      )
      .bind(defaultEmail, now, userId, userId, userId),
    env.DB
      .prepare(
        `INSERT INTO identity_subject_states
          (user_id, normalized_email, status, canonical_user_id, bootstrap_consumed, created_at, updated_at, changed_by_user_id)
         SELECT ?, NULL, 'current', ?, 1, ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM users WHERE id = ?) AND ${allowedSql}
         ON CONFLICT(user_id) DO UPDATE SET
           canonical_user_id = excluded.canonical_user_id,
           bootstrap_consumed = 1,
           updated_at = excluded.updated_at,
           changed_by_user_id = excluded.changed_by_user_id
         WHERE identity_subject_states.status = 'current'`,
      )
      .bind(userId, userId, now, now, userId, userId, userId, userId),
  ]);

  const state = await env.DB
    .prepare(
      `SELECT subject.status AS subject_status, tombstone.deleted_at, user.id AS live_user_id
       FROM (SELECT 1) seed
       LEFT JOIN identity_subject_states subject ON subject.user_id = ?
       LEFT JOIN deleted_users tombstone ON tombstone.id = ?
       LEFT JOIN users user ON user.id = ?`,
    )
    .bind(userId, userId, userId)
    .first<{ subject_status: string | null; deleted_at: string | null; live_user_id: string | null }>();
  if (state?.subject_status === "superseded") throw new Error("Identity subject is no longer current");
  if (state?.subject_status === "blocked" || state?.deleted_at) throw new Error("Session revoked by admin");
  if (!state?.live_user_id) throw new Error("User lifecycle invariant failed");
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
  simulationDefaultsPreference: (() => {
    if (!row.simulation_defaults_preference_json) return null;
    try {
      return JSON.parse(row.simulation_defaults_preference_json) as UserSimulationDefaultsPreference;
    } catch {
      return null;
    }
  })(),
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
      "SELECT id, username, email, username_set_at, bio, access_request_note, idp_email, idp_email_verified, avatar_url, email_public, default_frequency_preset_id, simulation_defaults_preference_json, avatar_object_key, avatar_thumb_key, avatar_hash, avatar_bytes, avatar_content_type, is_admin, is_moderator, is_approved, approved_at, approved_by_user_id, created_at, updated_at FROM users WHERE id = ?",
    )
    .bind(userId)
    .first<UserRow>();
};

export const ensureUser = async (
  env: Env,
  userId: string,
  tokenPayload?: Record<string, unknown>,
): Promise<void> => {
  await ensureSchema(env);
  const now = new Date().toISOString();
  const email = deriveDefaultEmail(userId, tokenPayload);
  const idpEmail = deriveVerifiedIdpEmail(tokenPayload);
  if (idpEmail) {
    await executeVerifiedIdentityEnsure(env, {
      userId,
      email: idpEmail,
      defaultEmail: email,
      bootstrapAdmin: parseAdminUserIds(env).has(userId.toLowerCase()),
      now,
    });
    return;
  }
  await executeUnverifiedIdentityEnsure(env, {
    userId,
    defaultEmail: email,
    bootstrapAdmin: parseAdminUserIds(env).has(userId.toLowerCase()),
    now,
  });
};

export const fetchUserProfile = async (env: Env, userId: string) => {
  const row = await readUserRow(env, userId);
  return row ? toUserProfile(row) : null;
};

export const fetchUserDiagnosticAccessState = async (
  env: Pick<Env, "DB">,
  userId: string,
): Promise<{ isAdmin: boolean; accountState: AccountState } | null> => {
  const row = await env.DB
    .prepare(
      `SELECT is_admin, is_moderator, is_approved, approved_at, approved_by_user_id
       FROM users WHERE id = ?`,
    )
    .bind(userId)
    .first<Pick<UserRow, "is_admin" | "is_moderator" | "is_approved" | "approved_at" | "approved_by_user_id">>();
  if (!row) return null;
  return {
    isAdmin: row.is_admin === 1,
    accountState:
      row.is_admin === 1 || row.is_moderator === 1 || row.is_approved === 1
        ? "approved"
        : typeof row.approved_by_user_id === "string" && row.approved_by_user_id.startsWith("revoked:")
          ? "revoked"
          : "pending",
  };
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
    simulationDefaultsPreference?: unknown;
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
  const nextSimulationDefaultsPreference =
    patch.simulationDefaultsPreference === undefined
      ? (existing.simulation_defaults_preference_json ?? null)
      : sanitizeSimulationDefaultsPreference(patch.simulationDefaultsPreference);
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
          simulation_defaults_preference_json = ?,
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
      nextSimulationDefaultsPreference ?? null,
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

export const listUsers = async (env: Env, includePrivateIdentity: boolean) => {
  await ensureSchema(env);
  const rows = await env.DB
    .prepare(
      "SELECT id, username, email, username_set_at, bio, access_request_note, idp_email, idp_email_verified, avatar_url, email_public, default_frequency_preset_id, simulation_defaults_preference_json, avatar_object_key, avatar_thumb_key, avatar_hash, avatar_bytes, avatar_content_type, is_admin, is_moderator, is_approved, approved_at, approved_by_user_id, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT 2000",
    )
    .all<UserRow>();
  return rows.results.map((row) => {
    const profile = toUserProfile(row);
    const { idpEmail, idpEmailVerified, ...ordinaryProfile } = profile;
    return {
      ...ordinaryProfile,
      email: includePrivateIdentity || row.email_public === 1 ? profile.email : "",
      ...(includePrivateIdentity ? { idpEmail, idpEmailVerified } : {}),
    };
  });
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

const EFFECTIVE_CANONICAL_USER_SQL = `COALESCE(
  (SELECT canonical_user_id FROM identity_subject_states WHERE user_id = ? AND status = 'superseded'),
  ?
)`;

export const resolveEffectiveCanonicalUserId = async (env: Pick<Env, "DB">, userId: string): Promise<string> => {
  const row = await env.DB
    .prepare(`SELECT ${EFFECTIVE_CANONICAL_USER_SQL} AS id`)
    .bind(userId, userId)
    .first<{ id: string }>();
  return row?.id || userId;
};

export const executeIdentityRoleChange = async (
  env: Pick<Env, "DB">,
  userId: string,
  role: UserRole,
  actorUserId: string,
  now: string,
): Promise<string> => {
  const revokedBy = `revoked:${actorUserId}`;
  const roleValues =
    role === "admin"
      ? { admin: 1, moderator: 0, approved: 1 }
      : role === "moderator"
        ? { admin: 0, moderator: 1, approved: 1 }
        : role === "user"
          ? { admin: 0, moderator: 0, approved: 1 }
          : { admin: 0, moderator: 0, approved: 0 };

  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE users
         SET is_admin = ?, is_moderator = ?, is_approved = ?,
             approved_at = CASE
               WHEN ? = 1 THEN COALESCE(approved_at, ?)
               ELSE approved_at END,
             approved_by_user_id = CASE
               WHEN ? = 1 THEN COALESCE(approved_by_user_id, ?)
               WHEN approved_at IS NULL THEN NULL
               ELSE ? END,
             updated_at = ?
         WHERE id = ${EFFECTIVE_CANONICAL_USER_SQL}`,
      )
      .bind(
        roleValues.admin,
        roleValues.moderator,
        roleValues.approved,
        roleValues.approved,
        now,
        roleValues.approved,
        actorUserId,
        revokedBy,
        now,
        userId,
        userId,
      ),
    env.DB
      .prepare(
        `INSERT INTO user_identity_audit
          (event_type, target_user_id, source_user_id, actor_user_id, idp_email, details_json, created_at)
         SELECT 'role_changed', effective.id, ?, ?,
                (SELECT normalized_email FROM identity_subject_states WHERE user_id = effective.id),
                json_object('requestedUserId', ?, 'role', ?), ?
         FROM (SELECT ${EFFECTIVE_CANONICAL_USER_SQL} AS id) effective
         WHERE EXISTS (SELECT 1 FROM users WHERE id = effective.id)`,
      )
      .bind(userId, actorUserId, userId, role, now, userId, userId),
  ]);
  return resolveEffectiveCanonicalUserId(env, userId);
};

export const setUserAdminFlag = async (env: Env, userId: string, isAdminRaw: unknown) => {
  await ensureSchema(env);
  const effectiveUserId = await executeIdentityRoleChange(
    env,
    userId,
    isAdminRaw ? "admin" : "user",
    "system:set-admin-flag",
    new Date().toISOString(),
  );
  const profile = await fetchUserProfile(env, effectiveUserId);
  if (!profile) throw new Error("User not found.");
  return profile;
};

export const setUserRole = async (env: Env, userId: string, role: UserRole, actorUserId: string) => {
  await ensureSchema(env);
  const now = new Date().toISOString();
  const effectiveUserId = await executeIdentityRoleChange(env, userId, role, actorUserId, now);
  const profile = await fetchUserProfile(env, effectiveUserId);
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

export const executeIdentityDelete = async (
  env: Pick<Env, "DB">,
  userId: string,
  actorUserId: string | undefined,
  now: string,
): Promise<string> => {
  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO user_identity_audit
          (event_type, target_user_id, source_user_id, actor_user_id, idp_email, details_json, created_at)
         SELECT 'user_deleted', effective.id, NULL, ?,
                COALESCE(
                  (SELECT normalized_email FROM identity_subject_states WHERE user_id = effective.id),
                  (SELECT normalized_email FROM verified_identity_claims WHERE current_user_id = effective.id ORDER BY normalized_email LIMIT 1),
                  (SELECT lower(idp_email) FROM users WHERE id = effective.id AND idp_email_verified = 1)
                ),
                json_object('requestedUserId', ?, 'durableBlock', json('true')), ?
         FROM (SELECT ${EFFECTIVE_CANONICAL_USER_SQL} AS id) effective
         WHERE EXISTS (SELECT 1 FROM users WHERE id = effective.id)`,
      )
      .bind(actorUserId ?? null, userId, now, userId, userId),
    env.DB
      .prepare(
        `INSERT INTO deleted_users (id, deleted_at, deleted_by_user_id)
         VALUES (${EFFECTIVE_CANONICAL_USER_SQL}, ?, ?)
         ON CONFLICT(id) DO UPDATE SET deleted_at = excluded.deleted_at, deleted_by_user_id = excluded.deleted_by_user_id`,
      )
      .bind(userId, userId, now, actorUserId ?? null),
    env.DB
      .prepare(
        `UPDATE verified_identity_claims
         SET status = 'blocked', blocked_at = ?, blocked_by_user_id = ?, updated_at = ?
         WHERE current_user_id = ${EFFECTIVE_CANONICAL_USER_SQL}`,
      )
      .bind(now, actorUserId ?? null, now, userId, userId),
    env.DB
      .prepare(
        `INSERT INTO identity_subject_states
          (user_id, normalized_email, status, canonical_user_id, bootstrap_consumed, created_at, updated_at, changed_by_user_id)
         SELECT effective.id,
                COALESCE(
                  (SELECT normalized_email FROM identity_subject_states WHERE user_id = effective.id),
                  (SELECT lower(idp_email) FROM users WHERE id = effective.id AND idp_email_verified = 1)
                ),
                'blocked', effective.id, 1, ?, ?, ?
         FROM (SELECT ${EFFECTIVE_CANONICAL_USER_SQL} AS id) effective
         WHERE 1 = 1
         ON CONFLICT(user_id) DO UPDATE SET
           status = 'blocked',
           canonical_user_id = excluded.canonical_user_id,
           updated_at = excluded.updated_at,
           changed_by_user_id = excluded.changed_by_user_id
         WHERE identity_subject_states.status IN ('current', 'blocked')`,
      )
      .bind(now, now, actorUserId ?? null, userId, userId),
    env.DB
      .prepare(`DELETE FROM users WHERE id = ${EFFECTIVE_CANONICAL_USER_SQL}`)
      .bind(userId, userId),
  ]);
  return resolveEffectiveCanonicalUserId(env, userId);
};

export const deleteUser = async (env: Env, userId: string, actorUserId?: string): Promise<void> => {
  await ensureSchema(env);
  await executeIdentityDelete(env, userId, actorUserId, new Date().toISOString());
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

export const executeIdentityRestore = async (
  env: Pick<Env, "DB">,
  userId: string,
  actorUserId: string | undefined,
  now: string,
): Promise<string> => {
  await env.DB.batch([
    env.DB
      .prepare(`DELETE FROM deleted_users WHERE id = ${EFFECTIVE_CANONICAL_USER_SQL}`)
      .bind(userId, userId),
    env.DB
      .prepare(
        `UPDATE identity_subject_states
         SET status = 'current', canonical_user_id = user_id, updated_at = ?, changed_by_user_id = ?
         WHERE user_id = ${EFFECTIVE_CANONICAL_USER_SQL} AND status = 'blocked'`,
      )
      .bind(now, actorUserId ?? null, userId, userId),
    env.DB
      .prepare(
        `UPDATE verified_identity_claims
         SET status = 'active', blocked_at = NULL, blocked_by_user_id = NULL, updated_at = ?
         WHERE current_user_id = ${EFFECTIVE_CANONICAL_USER_SQL} AND status = 'blocked'`,
      )
      .bind(now, userId, userId),
    env.DB
      .prepare(
        `INSERT INTO user_identity_audit
          (event_type, target_user_id, source_user_id, actor_user_id, idp_email, details_json, created_at)
         SELECT 'user_restored', effective.id, NULL, ?,
                (SELECT normalized_email FROM identity_subject_states WHERE user_id = effective.id),
                json_object('requestedUserId', ?), ?
         FROM (SELECT ${EFFECTIVE_CANONICAL_USER_SQL} AS id) effective`,
      )
      .bind(actorUserId ?? null, userId, now, userId, userId),
  ]);
  return resolveEffectiveCanonicalUserId(env, userId);
};

export const restoreDeletedUser = async (env: Env, userId: string, actorUserId?: string): Promise<void> => {
  await ensureSchema(env);
  await executeIdentityRestore(env, userId, actorUserId, new Date().toISOString());
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
  status?: "active" | "deleted";
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

type ResourceChangeAccessReason = "missing" | "forbidden";

export const deleteSiteResource = async (
  env: Env,
  actor: ActorPolicy,
  siteId: string,
): Promise<{ ok: true; siteId: string } | { ok: false; reason: "missing" | "forbidden" }> => {
  await ensureSchema(env);
  const id = siteId.trim();
  if (!id) return { ok: false, reason: "missing" };
  const existing = await env.DB
    .prepare("SELECT id, owner_user_id FROM sites WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string; owner_user_id: string }>();
  if (!existing) return { ok: false, reason: "missing" };
  if (!(actor.isAdmin || existing.owner_user_id === actor.id)) {
    return { ok: false, reason: "forbidden" };
  }
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO resource_changes
         (resource_kind, resource_id, action, actor_user_id, changed_at, note, details_json, snapshot_json)
       SELECT 'site', id, 'updated', ?, ?, 'Deleted Site', NULL,
              json_set(
                payload_json,
                '$.ownerUserId', owner_user_id,
                '$.visibility', CASE visibility
                  WHEN 'public_read' THEN 'public'
                  WHEN 'public_write' THEN 'shared'
                  ELSE 'private'
                END
              )
       FROM sites
       WHERE id = ? AND (? = 1 OR owner_user_id = ?)`,
    ).bind(actor.id, now, id, actor.isAdmin ? 1 : 0, actor.id),
    env.DB
      .prepare("DELETE FROM sites WHERE id = ? AND (? = 1 OR owner_user_id = ?)")
      .bind(id, actor.isAdmin ? 1 : 0, actor.id),
  ]) as D1Result[];
  const deleted = Number(results[1]?.meta?.changes ?? 0) > 0;
  if (!deleted) {
    const current = await env.DB
      .prepare("SELECT owner_user_id FROM sites WHERE id = ? LIMIT 1")
      .bind(id)
      .first<{ owner_user_id: string }>();
    return { ok: false, reason: current ? "forbidden" : "missing" };
  }
  return { ok: true, siteId: id };
};

const resolveResourceChangeAccess = async (
  env: Env,
  kind: "site" | "simulation",
  resourceId: string,
  actor: ActorPolicy,
  operation: "read" | "revert",
): Promise<{ ok: true } | { ok: false; reason: ResourceChangeAccessReason }> => {
  const table = kind === "site" ? "sites" : "simulations";
  const rolesTable = kind === "site" ? "site_roles" : "simulation_roles";
  const row = await env.DB
    .prepare(
      `SELECT t.owner_user_id, t.visibility${kind === "simulation" ? ", t.status" : ""}, r.role AS actor_role
       FROM ${table} t
       LEFT JOIN ${rolesTable} r ON r.${kind}_id = t.id AND r.user_id = ?
       WHERE t.id = ?
       LIMIT 1`,
    )
    .bind(actor.id, resourceId)
    .first<{
      owner_user_id: string;
      visibility: DbVisibility;
      status?: "active" | "deleted";
      actor_role?: string | null;
    }>();

  if (!row) return { ok: false, reason: "missing" };
  if (kind === "simulation" && row.status === "deleted") {
    return operation === "read" && actor.isAdmin
      ? { ok: true }
      : { ok: false, reason: "forbidden" };
  }

  const explicitRole = typeof row.actor_role === "string" ? row.actor_role : null;
  const visibility = visibilityFromDbVisibility(row.visibility);
  const allowed = operation === "read"
    ? canReadResource(actor, row.owner_user_id, visibility, explicitRole)
    : canEditResource(actor, row.owner_user_id, visibility, explicitRole);
  return allowed ? { ok: true } : { ok: false, reason: "forbidden" };
};

export const setSimulationLifecycleStatus = async (
  env: Env,
  actor: ActorPolicy,
  simulationId: string,
  status: "active" | "deleted",
): Promise<
  | { ok: true; simulationId: string; status: "active" | "deleted" }
  | { ok: false; reason: "missing" | "forbidden" }
> => {
  await ensureSchema(env);
  const id = simulationId.trim();
  if (!id) return { ok: false, reason: "missing" };
  const existing = await env.DB
    .prepare("SELECT id, owner_user_id, status, payload_json FROM simulations WHERE id = ? LIMIT 1")
    .bind(id)
    .first<{ id: string; owner_user_id: string; status: "active" | "deleted"; payload_json: string }>();
  if (!existing) return { ok: false, reason: "missing" };
  if (status === "deleted" && !(actor.isAdmin || existing.owner_user_id === actor.id)) {
    return { ok: false, reason: "forbidden" };
  }
  if (status === "active" && !actor.isAdmin) return { ok: false, reason: "forbidden" };
  if (existing.status === status) return { ok: true, simulationId: id, status };

  const now = new Date().toISOString();
  let snapshot: Record<string, unknown> | undefined;
  let nextPayload = existing.payload_json;
  try {
    snapshot = JSON.parse(existing.payload_json) as Record<string, unknown>;
    nextPayload = JSON.stringify({ ...snapshot, updatedAt: now });
  } catch {
    snapshot = undefined;
  }
  await env.DB
    .prepare(
      `UPDATE simulations
       SET status = ?, payload_json = ?, updated_at = ?, last_edited_at = ?, last_edited_by_user_id = ?
       WHERE id = ?`,
    )
    .bind(status, nextPayload, now, now, actor.id, id)
    .run();
  await createResourceChange(
    env,
    "simulation",
    id,
    "updated",
    actor.id,
    status === "deleted" ? "Deleted Simulation" : "Restored Simulation",
    { details: { changedFields: ["status"], diff: { status: { before: existing.status, after: status } } }, snapshot },
  );
  return { ok: true, simulationId: id, status };
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
  if (Array.isArray(item.sharedWith) && item.sharedWith.length > LIBRARY_MAX_GRANTS) {
    return { ok: false, reason: `too_many_grants_${kind}` };
  }
  const requestedSharedWith = sanitizeGrants(item.sharedWith);
  const now = new Date().toISOString();

  const existing = await env.DB
    .prepare(
      `SELECT t.owner_user_id, t.payload_json, t.name, t.visibility, t.created_at${kind === "simulation" ? ", t.status" : ""}, r.role AS actor_role
       FROM ${table} t
       LEFT JOIN ${rolesTable} r ON r.${kind}_id = t.id AND r.user_id = ?
       WHERE t.id = ?`,
    )
    .bind(actor.id, id)
    .first<ResourceRow & { actor_role?: string | null }>();

  if (existing) {
    if (kind === "simulation" && existing.status === "deleted") {
      return { ok: false, reason: "simulation_deleted" };
    }
    const existingVisibility = visibilityFromDbVisibility(existing.visibility);
    const actorRole = typeof existing.actor_role === "string" ? existing.actor_role : null;
    if (!canEditResource(actor, existing.owner_user_id, existingVisibility, actorRole)) {
      return { ok: false, reason: `forbidden_${kind}` };
    }
  }

  if (kind === "site" && !existing) {
    const tombstone = await env.DB
      .prepare(
        `SELECT id
         FROM resource_changes
         WHERE resource_kind = 'site' AND resource_id = ? AND note = 'Deleted Site'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .bind(id)
      .first<{ id: number }>();
    if (tombstone) return { ok: false, reason: "site_deleted" };
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
  const payloadBytes = new TextEncoder().encode(payload).byteLength;
  const maxPayloadBytes = kind === "site" ? LIBRARY_SITE_MAX_BYTES : LIBRARY_SIMULATION_MAX_BYTES;
  if (payloadBytes > maxPayloadBytes) return { ok: false, reason: `${kind}_too_large` };

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

  const wasPublic = existing ? existing.visibility !== "private" : false;
  const maxOwnerRecords = kind === "site" ? LIBRARY_MAX_SITES_PER_USER : LIBRARY_MAX_SIMULATIONS_PER_USER;
  const maxOwnerPublicRecords = kind === "site" ? LIBRARY_MAX_PUBLIC_SITES_PER_USER : LIBRARY_MAX_PUBLIC_SIMULATIONS_PER_USER;
  const activeQuotaClause = "";
  const siteTombstoneGuard = kind === "site"
    ? ` AND (
          EXISTS (SELECT 1 FROM sites WHERE id = ?)
          OR NOT EXISTS (
            SELECT 1 FROM resource_changes
            WHERE resource_kind = 'site' AND resource_id = ? AND note = 'Deleted Site'
          )
        )`
    : "";
  const writeStatement = env.DB.prepare(
      `INSERT INTO ${table}
       (id, owner_user_id, created_by_user_id, last_edited_by_user_id, created_at, last_edited_at, name, visibility, payload_json, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (? = 0 OR (SELECT COUNT(*) FROM ${table} WHERE owner_user_id = ?${activeQuotaClause}) < ?)
         AND (? = 'private' OR ? = 1 OR (SELECT COUNT(*) FROM ${table} WHERE owner_user_id = ? AND visibility != 'private'${activeQuotaClause}) < ?)
         ${siteTombstoneGuard}
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         visibility = excluded.visibility,
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at,
         last_edited_at = excluded.last_edited_at,
         last_edited_by_user_id = excluded.last_edited_by_user_id,
         created_by_user_id = COALESCE(${table}.created_by_user_id, excluded.created_by_user_id),
         created_at = COALESCE(${table}.created_at, excluded.created_at)
       WHERE ${table}.owner_user_id = ?
          OR ? = 1
          OR EXISTS (
            SELECT 1 FROM ${rolesTable}
            WHERE ${kind}_id = excluded.id AND user_id = ? AND role IN ('admin', 'editor')
          )`,
    )
    .bind(
      id,
      ownerId,
      ownerId,
      actor.id,
      existing?.created_at ?? now,
      now,
      name,
      visibilityDb,
      payload,
      now,
      isCreate ? 1 : 0,
      ownerId,
      maxOwnerRecords,
      visibilityDb,
      wasPublic ? 1 : 0,
      ownerId,
      maxOwnerPublicRecords,
      ...(kind === "site" ? [id, id] : []),
      actor.id,
      actor.isAdmin ? 1 : 0,
      actor.id,
    );
  const wroteCurrentPayloadGuard = `EXISTS (
    SELECT 1 FROM ${table}
    WHERE id = ? AND updated_at = ? AND last_edited_by_user_id = ? AND payload_json = ?
  )`;
  const roleStatements = [
    env.DB
      .prepare(`DELETE FROM ${rolesTable} WHERE ${kind}_id = ? AND ${wroteCurrentPayloadGuard}`)
      .bind(id, id, now, actor.id, payload),
    ...sharedWith
      .filter((grant) => grant.userId !== ownerId)
      .map((grant) => env.DB
        .prepare(
          `INSERT INTO ${rolesTable} (${kind}_id, user_id, role, created_at)
           SELECT ?, ?, ?, ?
           WHERE ${wroteCurrentPayloadGuard}
           ON CONFLICT(${kind}_id, user_id) DO UPDATE SET role = excluded.role`,
        )
        .bind(id, grant.userId, grant.role, now, id, now, actor.id, payload)),
  ];
  const [writeResult] = await env.DB.batch([writeStatement, ...roleStatements]) as D1Result[];
  if (writeResult.meta?.changes === 0) {
    if (kind === "site") {
      const tombstone = await env.DB
        .prepare(
          `SELECT id FROM resource_changes
           WHERE resource_kind = 'site' AND resource_id = ? AND note = 'Deleted Site'
           ORDER BY id DESC LIMIT 1`,
        )
        .bind(id)
        .first<{ id: number }>();
      if (tombstone) return { ok: false, reason: "site_deleted" };
    }
    const current = await env.DB
      .prepare(
        `SELECT t.owner_user_id, t.visibility, r.role AS actor_role
         FROM ${table} t
         LEFT JOIN ${rolesTable} r ON r.${kind}_id = t.id AND r.user_id = ?
         WHERE t.id = ? LIMIT 1`,
      )
      .bind(actor.id, id)
      .first<{ owner_user_id: string; visibility: DbVisibility; actor_role?: string | null }>();
    if (current && !canEditResource(
      actor,
      current.owner_user_id,
      visibilityFromDbVisibility(current.visibility),
      typeof current.actor_role === "string" ? current.actor_role : null,
    )) {
      return { ok: false, reason: `forbidden_${kind}` };
    }
    return { ok: false, reason: `${kind}_quota_exceeded` };
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

type QuotaResourceRow = {
  id: string;
  owner_user_id: string;
  visibility: DbVisibility;
};

type OwnerQuotaRow = {
  owner_user_id: string;
  total_count: number;
  public_count: number;
};

const preflightResourceQuotas = async (
  env: Env,
  kind: "site" | "simulation",
  actor: ActorPolicy,
  items: CloudResourceRecord[],
): Promise<void> => {
  if (items.length === 0) return;
  const table = kind === "site" ? "sites" : "simulations";
  const ids = items.map((item) => typeof item.id === "string" ? item.id.trim() : "");
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new LibraryValidationError(`Library request contains invalid or duplicate ${kind === "site" ? "Site" : "Simulation"} IDs.`);
  }
  const placeholders = ids.map(() => "?").join(", ");
  const existingRows = await env.DB
    .prepare(`SELECT id, owner_user_id, visibility FROM ${table} WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<QuotaResourceRow>();
  const existingById = new Map(existingRows.results.map((row) => [row.id, row]));
  const ownerIds = [...new Set(items.map((item) => existingById.get(item.id.trim())?.owner_user_id ?? actor.id))];
  const ownerPlaceholders = ownerIds.map(() => "?").join(", ");
  const activeClause = "";
  const counts = await env.DB
    .prepare(
      `SELECT owner_user_id,
              COUNT(*) AS total_count,
              SUM(CASE WHEN visibility != 'private' THEN 1 ELSE 0 END) AS public_count
       FROM ${table}
       WHERE owner_user_id IN (${ownerPlaceholders})${activeClause}
       GROUP BY owner_user_id`,
    )
    .bind(...ownerIds)
    .all<OwnerQuotaRow>();
  const state = new Map(ownerIds.map((ownerId) => {
    const row = counts.results.find((entry) => entry.owner_user_id === ownerId);
    const total = Number(row?.total_count ?? 0);
    const publicCount = Number(row?.public_count ?? 0);
    return [ownerId, { initialTotal: total, initialPublic: publicCount, total, publicCount }];
  }));

  for (const item of items) {
    const id = item.id.trim();
    const existing = existingById.get(id);
    const ownerId = existing?.owner_user_id ?? actor.id;
    const ownerState = state.get(ownerId)!;
    const nextVisibility = dbVisibilityFromVisibility(sanitizeVisibility(item.visibility));
    if (!existing) ownerState.total += 1;
    const wasPublic = existing ? existing.visibility !== "private" : false;
    const willBePublic = nextVisibility !== "private";
    if (wasPublic !== willBePublic) ownerState.publicCount += willBePublic ? 1 : -1;
  }

  const maxTotal = kind === "site" ? LIBRARY_MAX_SITES_PER_USER : LIBRARY_MAX_SIMULATIONS_PER_USER;
  const maxPublic = kind === "site" ? LIBRARY_MAX_PUBLIC_SITES_PER_USER : LIBRARY_MAX_PUBLIC_SIMULATIONS_PER_USER;
  for (const quota of state.values()) {
    if (quota.total > maxTotal && quota.total > quota.initialTotal) {
      throw new LibraryValidationError(`${kind === "site" ? "Site" : "Simulation"} Library quota exceeded.`);
    }
    if (quota.publicCount > maxPublic && quota.publicCount > quota.initialPublic) {
      throw new LibraryValidationError(`Public ${kind === "site" ? "Site" : "Simulation"} Library quota exceeded.`);
    }
  }
};

export const upsertLibrarySnapshot = async (
  env: Env,
  actor: ActorPolicy,
  payload: { siteLibrary: CloudResourceRecord[]; simulationPresets: CloudResourceRecord[] },
): Promise<{ upsertedSites: number; upsertedSimulations: number; conflicts: string[] }> => {
  await ensureSchema(env);
  if (payload.siteLibrary.length + payload.simulationPresets.length > LIBRARY_BATCH_MAX_RECORDS) {
    throw new LibraryValidationError(`Library request may contain at most ${LIBRARY_BATCH_MAX_RECORDS} records.`);
  }
  await preflightResourceQuotas(env, "site", actor, payload.siteLibrary);
  await preflightResourceQuotas(env, "simulation", actor, payload.simulationPresets);
  const conflicts: string[] = [];
  let upsertedSites = 0;
  let upsertedSimulations = 0;

  for (const site of payload.siteLibrary) {
    const result = await upsertOwnedResource(env, "site", actor, site);
    if (result.ok) upsertedSites += 1;
    else if (result.reason) conflicts.push(result.reason);
  }

  for (const simulation of payload.simulationPresets) {
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
  status?: "active" | "deleted";
};

export const fetchLibraryForUser = async (
  env: Env,
  userId: string,
  opts?: { since?: string },
): Promise<{ siteLibrary: CloudResourceRecord[]; simulationPresets: CloudResourceRecord[]; deletedSiteIds: string[]; deletedSimulationIds: string[] }> => {
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

  const deletedSiteAudienceClause = canReadAllResources
    ? ""
    : ` AND (
          json_extract(tombstone.snapshot_json, '$.ownerUserId') = ?
          OR json_extract(tombstone.snapshot_json, '$.visibility') IN ('public', 'shared')
          OR EXISTS (
            SELECT 1 FROM json_each(COALESCE(json_extract(tombstone.snapshot_json, '$.sharedWith'), '[]')) grant_entry
            WHERE json_extract(grant_entry.value, '$.userId') = ?
          )
        )`;
  const deletedSiteRows = await env.DB
        .prepare(
          `SELECT tombstone.resource_id AS id
           FROM resource_changes tombstone
           WHERE tombstone.resource_kind = 'site'
             AND tombstone.note = 'Deleted Site'
             AND tombstone.id = (
               SELECT MAX(latest.id)
               FROM resource_changes latest
               WHERE latest.resource_kind = 'site' AND latest.resource_id = tombstone.resource_id
             )
             AND NOT EXISTS (SELECT 1 FROM sites live WHERE live.id = tombstone.resource_id)
             ${deletedSiteAudienceClause}${opts?.since ? "\n             AND tombstone.changed_at > ?" : ""}`,
        )
        .bind(...(canReadAllResources ? [] : [userId, userId]), ...(opts?.since ? [opts.since] : []))
        .all<{ id: string }>();

  const deletedSimulationRows = canReadAllResources
    ? { results: [] as Array<{ id: string }> }
    : await env.DB
        .prepare(
          `SELECT s.id
           FROM simulations s
           LEFT JOIN simulation_roles r ON r.simulation_id = s.id AND r.user_id = ?
           WHERE s.status = 'deleted'
             AND (s.owner_user_id = ?
               OR s.visibility IN ('public_read', 'public_write')
               OR (r.user_id IS NOT NULL AND s.visibility != 'private'))${opts?.since ? "\n             AND s.updated_at > ?" : ""}`,
        )
        .bind(userId, userId, ...(opts?.since ? [opts.since] : []))
        .all<{ id: string }>();

  const simulationRows = await env.DB
    .prepare(
      `SELECT s.payload_json, s.owner_user_id, s.visibility, s.status, r.role,
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
       WHERE ((? = 1
          OR s.owner_user_id = ?
          OR s.visibility IN ('public_read', 'public_write')
          OR (r.user_id IS NOT NULL AND s.visibility != 'private'))
         AND (? = 1 OR s.status = 'active'))${opts?.since ? "\n          AND s.updated_at > ?" : ""}`,
    )
    .bind(userId, canReadAllResources ? 1 : 0, userId, canReadAllResources ? 1 : 0, ...(opts?.since ? [opts.since] : []))
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
            ...(row.status ? { status: row.status } : {}),
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
    deletedSiteIds: deletedSiteRows.results.map((row) => row.id),
    deletedSimulationIds: deletedSimulationRows.results.map((row) => row.id),
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
  actor: ActorPolicy,
): Promise<
  | {
      ok: true;
      changes: Array<{
        id: number;
        action: string;
        changedAt: string;
        note: string | null;
        actorUserId: string;
        actorName: string | null;
        actorAvatarUrl: string | null;
        details: { diff: Record<string, ResourceChangeDiffValue> } | null;
      }>;
    }
  | { ok: false; reason: ResourceChangeAccessReason }
> => {
  await ensureSchema(env);
  const access = await resolveResourceChangeAccess(env, kind, resourceId, actor, "read");
  if (!access.ok) return access;

  const rows = await env.DB
    .prepare(
      `SELECT c.id, c.action, c.changed_at, c.note, c.actor_user_id, c.details_json,
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
      actor_name: string | null;
      actor_avatar_url: string | null;
    }>();

  return {
    ok: true,
    changes: rows.results.map((row) => ({
      id: row.id,
      action: row.action,
      changedAt: row.changed_at,
      note: row.note,
      actorUserId: row.actor_user_id,
      actorName: row.actor_name,
      actorAvatarUrl: row.actor_avatar_url,
      details: readDisplayableChangeDetails(row.details_json),
    })),
  };
};

export const revertResourceFromChangeCopy = async (
  env: Env,
  kind: "site" | "simulation",
  resourceId: string,
  changeId: number,
  actor: ActorPolicy,
): Promise<{ ok: boolean; reason?: string }> => {
  await ensureSchema(env);
  const access = await resolveResourceChangeAccess(env, kind, resourceId, actor, "revert");
  if (!access.ok) return access;

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

  const result = await upsertOwnedResource(env, kind, actor, snapshot);
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
      `SELECT s.owner_user_id, s.visibility, s.status, r.role AS actor_role
       FROM simulations s
       LEFT JOIN simulation_roles r ON r.simulation_id = s.id AND r.user_id = ?
       WHERE s.id = ?`,
    )
    .bind(actor.id, id)
    .first<{ owner_user_id: string; visibility: DbVisibility; status: "active" | "deleted"; actor_role?: string | null }>();

  if (!row) return "missing";
  if (row.status === "deleted") return "missing";

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
    .prepare("SELECT id, name, payload_json FROM simulations WHERE status = 'active' LIMIT 8000")
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
    .prepare("SELECT id, name, payload_json FROM simulations WHERE owner_user_id = ? AND status = 'active' LIMIT 8000")
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
  options: {
    simulationId?: string;
    username?: string;
    simulationSlug?: string;
    actor: ActorPolicy | null;
  },
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
    .prepare("SELECT id, owner_user_id, payload_json, visibility, status FROM simulations WHERE id = ? LIMIT 1")
    .bind(resolvedId)
    .first<{ id: string; owner_user_id: string; payload_json: string; visibility: DbVisibility; status: "active" | "deleted" }>();
  if (!simulationRow) return { status: "missing" };
  if (simulationRow.status === "deleted") return { status: "missing" };
  const visibility = visibilityFromDbVisibility(simulationRow.visibility);

  let actorSimulationRole: string | null = null;
  if (options.actor) {
    const roleRow = await env.DB
      .prepare("SELECT role FROM simulation_roles WHERE simulation_id = ? AND user_id = ? LIMIT 1")
      .bind(resolvedId, options.actor.id)
      .first<{ role: string }>();
    if (roleRow) actorSimulationRole = roleRow.role;
  }
  const actor = options.actor ?? { id: "", isAdmin: false, isModerator: false };
  if (!canReadResource(actor, simulationRow.owner_user_id, visibility, actorSimulationRole)) {
    return { status: "forbidden" };
  }

  let simulation: CloudResourceRecord;
  try {
    simulation = JSON.parse(simulationRow.payload_json) as CloudResourceRecord;
  } catch {
    return { status: "missing" };
  }
  simulation.id = simulationRow.id;
  simulation.visibility = visibility;
  simulation.effectiveRole =
    options.actor?.isAdmin
      ? "admin"
      : options.actor?.id === simulationRow.owner_user_id
        ? "owner"
        : actorSimulationRole ?? "viewer";

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
    // Authorization to the parent Simulation includes the referenced Sites needed to render it.
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
