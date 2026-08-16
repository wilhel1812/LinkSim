import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteSiteResource,
  fetchUserDiagnosticAccessState,
  fetchLibraryForUser,
  fetchPublicSimulationBundle,
  fetchResourceChanges,
  listCollaboratorDirectory,
  listUsers,
  revertResourceFromChangeCopy,
  setSimulationLifecycleStatus,
  upsertLibrarySnapshot,
} from "./db";
import {
  LIBRARY_BATCH_MAX_RECORDS,
  LIBRARY_MAX_PUBLIC_SITES_PER_USER,
  LIBRARY_MAX_PUBLIC_SIMULATIONS_PER_USER,
  LIBRARY_MAX_SIMULATIONS_PER_USER,
  LIBRARY_MAX_SITES_PER_USER,
} from "../../src/lib/libraryLimits";

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
  verified_identity_claims: [
    "normalized_email", "current_user_id", "status", "created_at", "updated_at", "blocked_at", "blocked_by_user_id",
  ],
  identity_subject_states: [
    "user_id", "normalized_email", "status", "canonical_user_id", "bootstrap_consumed", "created_at", "updated_at", "changed_by_user_id",
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

  async run(): Promise<{ success: boolean; meta: { changes: number } }> {
    const quotaGuardRejected = this.db.rejectNextQuotaGuardedWrite && this.sql.includes("WHERE (? = 0 OR");
    if (quotaGuardRejected) this.db.rejectNextQuotaGuardedWrite = false;
    if (this.db.deleteSiteBeforeGuardedWrite && this.sql.includes("INSERT INTO sites")) {
      this.db.deleteSiteForConcurrentRace(this.db.deleteSiteBeforeGuardedWrite);
      this.db.deleteSiteBeforeGuardedWrite = null;
    }
    if (this.db.mutateBeforeGuardedWrite && (this.sql.includes("INSERT INTO sites") || this.sql.includes("INSERT INTO simulations"))) {
      const mutate = this.db.mutateBeforeGuardedWrite;
      this.db.mutateBeforeGuardedWrite = null;
      mutate();
    }
    const changes = quotaGuardRejected ? 0 : this.db.run(this.sql, this.bound);
    return { success: true, meta: { changes } };
  }
}

class FakeDb {
  readonly users: AnyRow[] = [];
  readonly sites = new Map<string, AnyRow>();
  readonly simulations = new Map<string, AnyRow>();
  readonly siteRoles = new Map<string, string>();
  readonly simulationRoles = new Map<string, string>();
  readonly resourceChanges: AnyRow[] = [];
  readonly adminUserIds = new Set<string>();
  rejectNextQuotaGuardedWrite = false;
  deleteSiteBeforeGuardedWrite: string | null = null;
  mutateBeforeGuardedWrite: (() => void) | null = null;
  reassignSiteOwnerBeforeBatch: { siteId: string; ownerUserId: string } | null = null;

  deleteSiteForConcurrentRace(siteId: string): void {
    const site = this.sites.get(siteId);
    if (!site) return;
    this.resourceChanges.push({
      id: this.resourceChanges.length + 1,
      resource_kind: "site",
      resource_id: siteId,
      action: "updated",
      actor_user_id: site.owner_user_id,
      changed_at: "2026-08-14T00:00:00.000Z",
      note: "Deleted Site",
      details_json: null,
      snapshot_json: site.payload_json,
    });
    this.sites.delete(siteId);
  }

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  async batch(statements: Array<{ run: () => Promise<unknown> }>): Promise<unknown[]> {
    if (this.reassignSiteOwnerBeforeBatch) {
      const { siteId, ownerUserId } = this.reassignSiteOwnerBeforeBatch;
      const site = this.sites.get(siteId);
      if (site) this.sites.set(siteId, { ...site, owner_user_id: ownerUserId });
      this.reassignSiteOwnerBeforeBatch = null;
    }
    const results: unknown[] = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }

  first(sql: string, bound: unknown[]): AnyRow | null {
    if (sql.includes("SELECT version FROM identity_lifecycle_meta")) {
      return { version: "2026-08-12-identity-lifecycle-v1" };
    }
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
    if (sql.includes("SELECT id, owner_user_id FROM sites WHERE id = ?")) {
      const row = this.sites.get(String(bound[0] ?? ""));
      return row ? { id: row.id, owner_user_id: row.owner_user_id } : null;
    }
    if (sql.includes("FROM resource_changes") && sql.includes("note = 'Deleted Site'") && sql.includes("LIMIT 1")) {
      const resourceId = String(bound[0] ?? "");
      const tombstone = [...this.resourceChanges]
        .reverse()
        .find((change) => change.resource_kind === "site" && change.resource_id === resourceId && change.note === "Deleted Site");
      return tombstone ? { id: tombstone.id } : null;
    }
    if (sql.includes("SELECT owner_user_id FROM sites WHERE id = ?")) {
      const row = this.sites.get(String(bound[0] ?? ""));
      return row ? { owner_user_id: row.owner_user_id } : null;
    }
    if (sql.includes("FROM simulations t") && sql.includes("LEFT JOIN simulation_roles")) {
      const id = String(bound[1] ?? "");
      const row = this.simulations.get(id);
      if (!row) return null;
      return { ...row, actor_role: this.simulationRoles.get(`${id}:${String(bound[0] ?? "")}`) ?? null };
    }
    if (sql.includes("FROM sites t") && sql.includes("LEFT JOIN site_roles")) {
      const id = String(bound[1] ?? "");
      const row = this.sites.get(id);
      if (!row) return null;
      return { ...row, actor_role: this.siteRoles.get(`${id}:${String(bound[0] ?? "")}`) ?? null };
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
    if (sql.includes("SELECT snapshot_json") && sql.includes("FROM resource_changes")) {
      const [changeId, kind, resourceId] = bound;
      return this.resourceChanges.find(
        (change) => change.id === changeId && change.resource_kind === kind && change.resource_id === resourceId,
      ) ?? null;
    }
    return null;
  }

  all(sql: string, bound: unknown[] = []): AnyRow[] {
    if (sql.includes("SELECT live.id") && sql.includes("current_role")) {
      const userId = String(bound[0] ?? "");
      const kind = String(bound[2] ?? "") as "site" | "simulation";
      const rows = kind === "site" ? this.sites : this.simulations;
      const roles = kind === "site" ? this.siteRoles : this.simulationRoles;
      return [...rows.values()]
        .filter((row) => row.owner_user_id !== userId && row.visibility === "private")
        .filter((row) => kind !== "simulation" || row.status === "active")
        .filter((row) => !roles.has(`${row.id}:${userId}`))
        .filter((row) => {
          const history = this.resourceChanges
            .filter((change) => change.resource_kind === kind && change.resource_id === row.id)
            .sort((left, right) => left.id - right.id);
          return history.some((_change, index) => index > 0 && history.slice(0, index).some((prior) => {
            const snapshot = JSON.parse(String(prior.snapshot_json ?? "{}")) as AnyRow;
            return snapshot.ownerUserId === userId
              || snapshot.visibility === "public"
              || snapshot.visibility === "shared"
              || (Array.isArray(snapshot.sharedWith) && snapshot.sharedWith.some((grant) => (
                grant && typeof grant === "object" && (grant as AnyRow).userId === userId
              )));
          }));
        })
        .map((row) => ({ id: row.id }));
    }
    const pragmaMatch = sql.match(/^PRAGMA table_info\(([^)]+)\)$/i);
    if (pragmaMatch) {
      const table = pragmaMatch[1] ?? "";
      return (TABLE_COLUMNS[table] ?? []).map((name) => ({ name }));
    }
    if (sql.includes("FROM users ORDER BY created_at DESC")) return this.users;
    if (sql.includes("CASE WHEN email_public = 1") && sql.includes("FROM users")) {
      return this.users.map((row) => ({
        id: row.id,
        username: row.username,
        visible_email: row.email_public === 1 ? row.email ?? row.idp_email ?? "" : "",
        avatar_url: row.avatar_url ?? "",
        avatar_thumb_key: row.avatar_thumb_key ?? null,
      }));
    }
    if (sql.includes("SELECT id, owner_user_id, visibility FROM sites WHERE id IN")) {
      return bound.map((id) => this.sites.get(String(id))).filter((row): row is AnyRow => Boolean(row));
    }
    if (sql.includes("SELECT id, owner_user_id, visibility FROM simulations WHERE id IN")) {
      return bound.map((id) => this.simulations.get(String(id))).filter((row): row is AnyRow => Boolean(row));
    }
    if (sql.includes("COUNT(*) AS total_count") && sql.includes("FROM sites")) {
      return bound.map((ownerId) => {
        const rows = [...this.sites.values()].filter((row) => row.owner_user_id === ownerId);
        return {
          owner_user_id: ownerId,
          total_count: rows.length,
          public_count: rows.filter((row) => row.visibility !== "private").length,
        };
      });
    }
    if (sql.includes("COUNT(*) AS total_count") && sql.includes("FROM simulations")) {
      return bound.map((ownerId) => {
        const rows = [...this.simulations.values()].filter((row) => row.owner_user_id === ownerId);
        return {
          owner_user_id: ownerId,
          total_count: rows.length,
          public_count: rows.filter((row) => row.visibility !== "private").length,
        };
      });
    }
    if (sql.includes("SELECT id, payload_json, visibility FROM sites WHERE id IN")) {
      return bound.map((id) => this.sites.get(String(id))).filter((row): row is AnyRow => Boolean(row));
    }
    if (sql.includes("FROM resource_changes c")) {
      const [kind, resourceId] = bound;
      return this.resourceChanges
        .filter((change) => change.resource_kind === kind && change.resource_id === resourceId)
        .map((change) => {
          const user = this.users.find((candidate) => candidate.id === change.actor_user_id);
          return {
            ...change,
            actor_name: String(change.actor_user_id),
            actor_avatar_url: user?.avatar_url ?? "",
            actor_avatar_thumb_key: user?.avatar_thumb_key ?? null,
          };
        });
    }
    if (sql.includes("SELECT s.id") && sql.includes("s.status = 'deleted'")) {
      const userId = String(bound[1] ?? "");
      return [...this.simulations.values()]
        .filter((row) => row.status === "deleted" && (
          row.owner_user_id === userId
          || row.visibility !== "private"
          || this.resourceChanges.some((change) => {
            if (change.resource_kind !== "simulation" || change.resource_id !== row.id) return false;
            const snapshot = JSON.parse(String(change.snapshot_json ?? "{}")) as AnyRow;
            return snapshot.ownerUserId === userId
              || snapshot.visibility === "public"
              || snapshot.visibility === "shared"
              || (Array.isArray(snapshot.sharedWith) && snapshot.sharedWith.some((grant) => (
                grant && typeof grant === "object" && (grant as AnyRow).userId === userId
              )));
          })
        ))
        .map((row) => ({ id: row.id }));
    }
    if (sql.includes("tombstone.resource_id AS id")) {
      const userId = String(bound[0] ?? "");
      const restrictAudience = sql.includes("json_extract(tombstone.snapshot_json, '$.ownerUserId')");
      return this.resourceChanges
        .filter((change) => change.resource_kind === "site" && change.note === "Deleted Site")
        .filter((change, index, changes) => changes.findLastIndex((entry) => entry.resource_id === change.resource_id) === index)
        .filter((change) => !this.sites.has(String(change.resource_id)))
        .filter((change) => {
          if (!restrictAudience) return true;
          const snapshot = JSON.parse(String(change.snapshot_json ?? "{}")) as AnyRow;
          const currentAudience = snapshot.ownerUserId === userId
            || snapshot.visibility === "public"
            || snapshot.visibility === "shared"
            || (Array.isArray(snapshot.sharedWith) && snapshot.sharedWith.some((grant) => (
              grant && typeof grant === "object" && (grant as AnyRow).userId === userId
            )));
          if (currentAudience) return true;
          return this.resourceChanges.some((history) => {
            if (history.resource_kind !== "site" || history.resource_id !== change.resource_id || history.id >= change.id) return false;
            const prior = JSON.parse(String(history.snapshot_json ?? "{}")) as AnyRow;
            return prior.ownerUserId === userId
              || prior.visibility === "public"
              || prior.visibility === "shared"
              || (Array.isArray(prior.sharedWith) && prior.sharedWith.some((grant) => (
                grant && typeof grant === "object" && (grant as AnyRow).userId === userId
              )));
          });
        })
        .map((change) => ({ id: change.resource_id }));
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
          owner_avatar_url: row.owner_avatar_url ?? "",
          owner_avatar_thumb_key: row.owner_avatar_thumb_key ?? null,
          created_by_name: null,
          created_by_avatar_url: row.created_by_avatar_url ?? null,
          created_by_avatar_thumb_key: row.created_by_avatar_thumb_key ?? null,
          first_actor_user_id: null,
          first_actor_name: null,
          first_actor_avatar_url: row.first_actor_avatar_url ?? null,
          first_actor_avatar_thumb_key: row.first_actor_avatar_thumb_key ?? null,
          last_edited_by_name: null,
          last_edited_by_avatar_url: row.last_edited_by_avatar_url ?? null,
          last_edited_by_avatar_thumb_key: row.last_edited_by_avatar_thumb_key ?? null,
          last_actor_user_id: null,
          last_actor_name: null,
          last_actor_avatar_url: row.last_actor_avatar_url ?? null,
          last_actor_avatar_thumb_key: row.last_actor_avatar_thumb_key ?? null,
        }));
    }
    if (sql.includes("SELECT s.payload_json") && sql.includes("FROM sites s")) {
      const userId = String(bound[2] ?? "");
      const isAdmin = Number(bound[1] ?? 0) === 1;
      return [...this.sites.values()]
        .filter((row) => isAdmin || row.owner_user_id === userId || row.visibility !== "private")
        .map((row) => ({
          ...row,
          role: null,
          owner_name: String(row.owner_user_id),
          owner_avatar_url: "",
          owner_avatar_thumb_key: null,
          created_by_user_id: row.created_by_user_id ?? row.owner_user_id,
          created_by_name: String(row.created_by_user_id ?? row.owner_user_id),
          created_by_avatar_url: null,
          created_by_avatar_thumb_key: null,
          first_actor_user_id: null,
          first_actor_name: null,
          first_actor_avatar_url: null,
          first_actor_avatar_thumb_key: null,
          last_edited_by_user_id: row.last_edited_by_user_id ?? row.owner_user_id,
          last_edited_by_name: String(row.last_edited_by_user_id ?? row.owner_user_id),
          last_edited_by_avatar_url: null,
          last_edited_by_avatar_thumb_key: null,
          last_actor_user_id: null,
          last_actor_name: null,
          last_actor_avatar_url: null,
          last_actor_avatar_thumb_key: null,
        }));
    }
    return [];
  }

  run(sql: string, bound: unknown[]): number {
    if (sql.includes("INSERT INTO simulations")) {
      const [id, ownerUserId, createdByUserId, lastEditedByUserId, createdAt, lastEditedAt, name, visibility, payloadJson, updatedAt] =
        bound;
      const existing = this.simulations.get(String(id));
      const actorId = String(bound[3] ?? "");
      const isAdmin = Number(bound[bound.length - 3] ?? 0) === 1;
      const role = this.simulationRoles.get(`${String(id)}:${actorId}`);
      if (existing && !(isAdmin || existing.owner_user_id === actorId || role === "admin" || role === "editor")) return 0;
      if (existing?.status === "deleted" && sql.includes("simulations.status = 'active'")) return 0;
      if (existing && visibility !== "private" && existing.visibility === "private") {
        const publicCount = [...this.simulations.values()].filter(
          (row) => row.owner_user_id === existing.owner_user_id && row.visibility !== "private",
        ).length;
        if (publicCount >= LIBRARY_MAX_PUBLIC_SIMULATIONS_PER_USER) return 0;
      }
      this.simulations.set(String(id), {
        ...existing,
        id,
        owner_user_id: existing?.owner_user_id ?? ownerUserId,
        created_by_user_id: existing?.created_by_user_id ?? createdByUserId,
        last_edited_by_user_id: lastEditedByUserId,
        created_at: createdAt,
        last_edited_at: lastEditedAt,
        name,
        visibility,
        status: existing?.status ?? "active",
        payload_json: payloadJson,
        updated_at: updatedAt,
      });
      return 1;
    }
    if (sql.includes("INSERT INTO sites")) {
      const [id, ownerUserId, createdByUserId, lastEditedByUserId, createdAt, lastEditedAt, name, visibility, payloadJson, updatedAt] =
        bound;
      const hasTombstone = this.resourceChanges.some(
        (change) => change.resource_kind === "site" && change.resource_id === id && change.note === "Deleted Site",
      );
      if (sql.includes("NOT EXISTS") && !this.sites.has(String(id)) && hasTombstone) return 0;
      const existing = this.sites.get(String(id));
      const actorId = String(bound[3] ?? "");
      const isAdmin = Number(bound[bound.length - 3] ?? 0) === 1;
      const role = this.siteRoles.get(`${String(id)}:${actorId}`);
      if (existing && !(isAdmin || existing.owner_user_id === actorId || role === "admin" || role === "editor")) return 0;
      if (existing && visibility !== "private" && existing.visibility === "private") {
        const publicCount = [...this.sites.values()].filter(
          (row) => row.owner_user_id === existing.owner_user_id && row.visibility !== "private",
        ).length;
        if (publicCount >= LIBRARY_MAX_PUBLIC_SITES_PER_USER) return 0;
      }
      this.sites.set(String(id), {
        ...existing,
        id,
        owner_user_id: existing?.owner_user_id ?? ownerUserId,
        created_by_user_id: existing?.created_by_user_id ?? createdByUserId,
        last_edited_by_user_id: lastEditedByUserId,
        created_at: createdAt,
        last_edited_at: lastEditedAt,
        name,
        visibility,
        payload_json: payloadJson,
        updated_at: updatedAt,
      });
      return 1;
    }
    if (sql.includes("INSERT INTO resource_changes") && sql.includes("'Deleted Site'")) {
      const [actorUserId, changedAt, resourceId, isAdmin, actorId] = bound;
      const site = this.sites.get(String(resourceId));
      if (!site || !(Number(isAdmin) === 1 || site.owner_user_id === actorId)) return 0;
      const payload = JSON.parse(String(site.payload_json ?? "{}")) as AnyRow;
      this.resourceChanges.push({
        id: this.resourceChanges.length + 1,
        resource_kind: "site",
        resource_id: resourceId,
        action: "updated",
        actor_user_id: actorUserId,
        changed_at: changedAt,
        note: "Deleted Site",
        details_json: null,
        snapshot_json: JSON.stringify({
          ...payload,
          ownerUserId: site.owner_user_id,
          visibility: site.visibility === "public_read" ? "public" : site.visibility === "public_write" ? "shared" : "private",
        }),
      });
      return 1;
    }
    if (sql.includes("INSERT INTO resource_changes")) {
      const [resourceKind, resourceId, action, actorUserId, changedAt, note, detailsJson, snapshotJson] = bound;
      this.resourceChanges.push({
        id: this.resourceChanges.length + 1,
        resource_kind: resourceKind,
        resource_id: resourceId,
        action,
        actor_user_id: actorUserId,
        changed_at: changedAt,
        note,
        details_json: detailsJson,
        snapshot_json: snapshotJson,
      });
      return 1;
    }
    if (sql.includes("INSERT INTO site_roles")) {
      if (bound.length > 4) {
        const [resourceId, , , , guardId, updatedAt, actorId, payloadJson] = bound;
        const site = this.sites.get(String(guardId));
        if (!site || site.updated_at !== updatedAt || site.last_edited_by_user_id !== actorId || site.payload_json !== payloadJson) return 0;
        if (resourceId !== guardId) return 0;
      }
      this.siteRoles.set(`${String(bound[0] ?? "")}:${String(bound[1] ?? "")}`, String(bound[2] ?? ""));
      return 1;
    }
    if (sql.includes("INSERT INTO simulation_roles")) {
      if (bound.length > 4) {
        const [resourceId, , , , guardId, updatedAt, actorId, payloadJson] = bound;
        const simulation = this.simulations.get(String(guardId));
        if (!simulation || simulation.status === "deleted" || simulation.updated_at !== updatedAt || simulation.last_edited_by_user_id !== actorId || simulation.payload_json !== payloadJson) return 0;
        if (resourceId !== guardId) return 0;
      }
      this.simulationRoles.set(`${String(bound[0] ?? "")}:${String(bound[1] ?? "")}`, String(bound[2] ?? ""));
      return 1;
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
      return 1;
    }
    if (sql.includes("DELETE FROM site_roles")) {
      const resourceId = String(bound[0] ?? "");
      if (bound.length > 1) {
        const site = this.sites.get(String(bound[1]));
        if (!site || site.updated_at !== bound[2] || site.last_edited_by_user_id !== bound[3] || site.payload_json !== bound[4]) return 0;
      }
      for (const key of this.siteRoles.keys()) {
        if (key.startsWith(`${resourceId}:`)) this.siteRoles.delete(key);
      }
      return 1;
    }
    if (sql.includes("DELETE FROM simulation_roles")) {
      const resourceId = String(bound[0] ?? "");
      if (bound.length > 1) {
        const simulation = this.simulations.get(String(bound[1]));
        if (!simulation || simulation.status === "deleted" || simulation.updated_at !== bound[2] || simulation.last_edited_by_user_id !== bound[3] || simulation.payload_json !== bound[4]) return 0;
      }
      for (const key of this.simulationRoles.keys()) {
        if (key.startsWith(`${resourceId}:`)) this.simulationRoles.delete(key);
      }
      return 1;
    }
    if (sql.includes("DELETE FROM sites WHERE id = ?")) {
      const [resourceId, isAdmin, actorId] = bound;
      const id = String(resourceId ?? "");
      const site = this.sites.get(id);
      if (!site || !(Number(isAdmin) === 1 || site.owner_user_id === actorId)) return 0;
      this.sites.delete(id);
      for (const key of this.siteRoles.keys()) {
        if (key.startsWith(`${id}:`)) this.siteRoles.delete(key);
      }
      return 1;
    }
    return 1;
  }
}

const userRow = (overrides: AnyRow = {}): AnyRow => ({
  id: "user-1", username: "User", email: "hidden@example.test", username_set_at: "2026-01-01",
  bio: "", access_request_note: "", idp_email: "verified@example.test", idp_email_verified: 1,
  avatar_url: "", email_public: 0, default_frequency_preset_id: null,
  simulation_defaults_preference_json: null, avatar_object_key: null, avatar_thumb_key: null,
  avatar_hash: null, avatar_bytes: null, avatar_content_type: null, is_admin: 0, is_moderator: 0,
  is_approved: 1, approved_at: "2026-01-01", approved_by_user_id: "admin-1",
  created_at: "2026-01-01", updated_at: "2026-01-01", ...overrides,
});

const avatarObjectKey = "users/123e4567-e89b-42d3-a456-426614174000/avatar-0123456789abcdef.webp";
const avatarThumbKey = "users/123e4567-e89b-42d3-a456-426614174000/avatar-0123456789abcdef-thumb.webp";
const avatarUrl = `/api/avatar/${avatarObjectKey}`;
const avatarThumbUrl = `/api/avatar/${avatarThumbKey}`;

describe("user identity privacy and diagnostic access", () => {
  it("redacts private profile and IdP email from moderator directory reads", async () => {
    const db = new FakeDb();
    db.users.push(userRow());

    const [profile] = await listUsers({ DB: db } as unknown as Parameters<typeof listUsers>[0], false);

    expect(profile?.email).toBe("");
    expect(profile).not.toHaveProperty("idpEmail");
    expect(profile).not.toHaveProperty("idpEmailVerified");
  });

  it("includes private identity only for an administrator directory read", async () => {
    const db = new FakeDb();
    db.users.push(userRow());

    const [profile] = await listUsers({ DB: db } as unknown as Parameters<typeof listUsers>[0], true);

    expect(profile).toMatchObject({
      email: "hidden@example.test",
      idpEmail: "verified@example.test",
      idpEmailVerified: true,
    });
  });

  it("uses the stored thumbnail for user list DTOs while preserving the avatarUrl field", async () => {
    const db = new FakeDb();
    db.users.push(userRow({ avatar_url: avatarUrl, avatar_thumb_key: avatarThumbKey }));

    const [profile] = await listUsers({ DB: db } as unknown as Parameters<typeof listUsers>[0], false);

    expect(profile?.avatarUrl).toBe(avatarThumbUrl);
  });

  it("uses the stored thumbnail for collaborator directory DTOs", async () => {
    const db = new FakeDb();
    db.users.push(userRow({ avatar_url: avatarUrl, avatar_thumb_key: avatarThumbKey }));

    const [profile] = await listCollaboratorDirectory(
      { DB: db } as unknown as Parameters<typeof listCollaboratorDirectory>[0],
    );

    expect(profile?.avatarUrl).toBe(avatarThumbUrl);
  });

  it("reads current diagnostic authority directly from DB role and revocation state", async () => {
    const db = new FakeDb();
    db.adminUserIds.add("admin-1");

    await expect(fetchUserDiagnosticAccessState(
      { DB: db } as unknown as Parameters<typeof fetchUserDiagnosticAccessState>[0],
      "admin-1",
    )).resolves.toEqual({ isAdmin: true, accountState: "approved" });
  });
});

describe("upsertLibrarySnapshot shared simulations", () => {
  it("falls back to updated_at for legacy Sites without created_at metadata", async () => {
    const db = new FakeDb();
    db.sites.set("site-legacy-date", {
      id: "site-legacy-date", owner_user_id: "owner-1", visibility: "private",
      created_at: null, updated_at: "2026-08-16T10:00:00.000Z", last_edited_at: null,
      payload_json: JSON.stringify({
        id: "site-legacy-date", name: "Legacy Site", visibility: "private", sharedWith: [],
        position: { lat: 60, lon: 11 }, groundElevationM: 100, antennaHeightM: 2,
        txPowerDbm: 20, txGainDbi: 2, rxGainDbi: 2, cableLossDb: 1,
      }),
    });
    const env = { DB: db } as unknown as Parameters<typeof fetchLibraryForUser>[0];

    const library = await fetchLibraryForUser(env, "owner-1");

    expect(library.siteLibrary).toEqual([
      expect.objectContaining({ id: "site-legacy-date", createdAt: "2026-08-16T10:00:00.000Z" }),
    ]);
  });

  it("persists one-character and longer resource names under the existing non-empty contract", async () => {
    const db = new FakeDb();
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];
    const longName = "L".repeat(160);

    await expect(upsertLibrarySnapshot(
      env,
      { id: "owner-1", isAdmin: false, isModerator: false },
      {
        siteLibrary: [
          { id: "site-short", name: "X", visibility: "private" },
          { id: "site-long", name: longName, visibility: "private" },
        ],
        simulationPresets: [
          { id: "sim-short", name: "X", visibility: "private" },
          { id: "sim-long", name: longName, visibility: "private" },
        ],
      },
    )).resolves.toMatchObject({ upsertedSites: 2, upsertedSimulations: 2, conflicts: [] });
    expect(db.sites.get("site-short")?.name).toBe("X");
    expect(db.sites.get("site-long")?.name).toBe(longName);
    expect(db.simulations.get("sim-short")?.name).toBe("X");
    expect(db.simulations.get("sim-long")?.name).toBe(longName);
  });

  it("deletes Sites only for their owner or a platform admin", async () => {
    const db = new FakeDb();
    db.sites.set("site-owner", {
      id: "site-owner",
      owner_user_id: "owner-1",
      visibility: "private",
      payload_json: JSON.stringify({ id: "site-owner", name: "Owner Site", sharedWith: [] }),
    });
    const env = { DB: db } as unknown as Parameters<typeof deleteSiteResource>[0];

    await expect(deleteSiteResource(env, { id: "other-1", isAdmin: false, isModerator: false }, "site-owner"))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
    expect(db.sites.has("site-owner")).toBe(true);

    await expect(deleteSiteResource(env, { id: "owner-1", isAdmin: false, isModerator: false }, "site-owner"))
      .resolves.toEqual({ ok: true, siteId: "site-owner" });
    expect(db.sites.has("site-owner")).toBe(false);

    db.sites.set("site-admin", {
      id: "site-admin",
      owner_user_id: "owner-2",
      visibility: "private",
      payload_json: JSON.stringify({ id: "site-admin", name: "Admin Site", sharedWith: [] }),
    });
    await expect(deleteSiteResource(env, { id: "admin-1", isAdmin: true, isModerator: false }, "site-admin"))
      .resolves.toEqual({ ok: true, siteId: "site-admin" });
  });

  it("atomically guards Site deletion when ownership changes after the access read", async () => {
    const db = new FakeDb();
    db.sites.set("site-race", {
      id: "site-race",
      owner_user_id: "owner-1",
      visibility: "private",
      payload_json: JSON.stringify({ id: "site-race", name: "Race Site", sharedWith: [] }),
    });
    db.siteRoles.set("site-race:editor-1", "editor");
    db.reassignSiteOwnerBeforeBatch = { siteId: "site-race", ownerUserId: "owner-2" };
    const env = { DB: db } as unknown as Parameters<typeof deleteSiteResource>[0];

    await expect(deleteSiteResource(env, { id: "owner-1", isAdmin: false, isModerator: false }, "site-race"))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
    expect(db.sites.get("site-race")?.owner_user_id).toBe("owner-2");
    expect(db.siteRoles.get("site-race:editor-1")).toBe("editor");
    expect(db.resourceChanges).toEqual([]);
  });

  it("returns Site tombstones to former readers and rejects stale recreation", async () => {
    const db = new FakeDb();
    db.sites.set("site-deleted", {
      id: "site-deleted",
      owner_user_id: "owner-1",
      visibility: "private",
      payload_json: JSON.stringify({
        id: "site-deleted", name: "Deleted Site", visibility: "private",
        sharedWith: [{ userId: "reader-1", role: "viewer" }],
      }),
    });
    const env = { DB: db } as unknown as Parameters<typeof deleteSiteResource>[0];

    await expect(deleteSiteResource(env, { id: "owner-1", isAdmin: false, isModerator: false }, "site-deleted"))
      .resolves.toEqual({ ok: true, siteId: "site-deleted" });
    await expect(fetchLibraryForUser(env, "reader-1")).resolves.toMatchObject({ deletedSiteIds: ["site-deleted"] });
    db.adminUserIds.add("admin-1");
    await expect(fetchLibraryForUser(env, "admin-1")).resolves.toMatchObject({ deletedSiteIds: ["site-deleted"] });
    await expect(upsertLibrarySnapshot(
      env,
      { id: "owner-1", isAdmin: false, isModerator: false },
      { siteLibrary: [{ id: "site-deleted", name: "Stale copy", visibility: "private" }], simulationPresets: [] },
    )).resolves.toMatchObject({ upsertedSites: 0, conflicts: ["site_deleted"] });
    expect(db.sites.has("site-deleted")).toBe(false);
  });

  it("returns removal markers when a live private resource revokes a former reader", async () => {
    const db = new FakeDb();
    db.sites.set("site-revoked", {
      id: "site-revoked", owner_user_id: "owner-1", visibility: "private",
      payload_json: JSON.stringify({ id: "site-revoked", name: "Private now", visibility: "private", sharedWith: [] }),
    });
    db.simulations.set("sim-revoked", {
      id: "sim-revoked", owner_user_id: "owner-1", visibility: "private", status: "active",
      payload_json: JSON.stringify({ id: "sim-revoked", name: "Private now", visibility: "private", sharedWith: [] }),
    });
    for (const kind of ["site", "simulation"] as const) {
      const resourceId = kind === "site" ? "site-revoked" : "sim-revoked";
      db.resourceChanges.push(
        { id: db.resourceChanges.length + 1, resource_kind: kind, resource_id: resourceId, changed_at: "2026-08-16T10:00:00.000Z", snapshot_json: JSON.stringify({ visibility: "shared", sharedWith: [{ userId: "reader-1", role: "viewer" }] }) },
        { id: db.resourceChanges.length + 2, resource_kind: kind, resource_id: resourceId, changed_at: "2026-08-16T10:01:00.000Z", snapshot_json: JSON.stringify({ visibility: "private", sharedWith: [] }) },
      );
    }
    const env = { DB: db } as unknown as Parameters<typeof fetchLibraryForUser>[0];
    await expect(fetchLibraryForUser(env, "reader-1")).resolves.toMatchObject({
      removedSiteIds: ["site-revoked"],
      removedSimulationIds: ["sim-revoked"],
    });
  });

  it("returns deletion markers when revocation is followed by deletion before the reader syncs", async () => {
    const db = new FakeDb();
    db.simulations.set("sim-revoked-deleted", {
      id: "sim-revoked-deleted", owner_user_id: "owner-1", visibility: "private", status: "deleted",
      updated_at: "2026-08-16T10:02:00.000Z",
      payload_json: JSON.stringify({ id: "sim-revoked-deleted", visibility: "private", sharedWith: [] }),
    });
    db.resourceChanges.push(
      { id: 1, resource_kind: "site", resource_id: "site-revoked-deleted", changed_at: "2026-08-16T10:00:00.000Z", snapshot_json: JSON.stringify({ visibility: "shared", sharedWith: [{ userId: "reader-1", role: "viewer" }] }) },
      { id: 2, resource_kind: "site", resource_id: "site-revoked-deleted", changed_at: "2026-08-16T10:01:00.000Z", snapshot_json: JSON.stringify({ visibility: "private", sharedWith: [] }) },
      { id: 3, resource_kind: "site", resource_id: "site-revoked-deleted", changed_at: "2026-08-16T10:02:00.000Z", note: "Deleted Site", snapshot_json: JSON.stringify({ visibility: "private", sharedWith: [] }) },
      { id: 4, resource_kind: "simulation", resource_id: "sim-revoked-deleted", changed_at: "2026-08-16T10:00:00.000Z", snapshot_json: JSON.stringify({ visibility: "shared", sharedWith: [{ userId: "reader-1", role: "viewer" }] }) },
      { id: 5, resource_kind: "simulation", resource_id: "sim-revoked-deleted", changed_at: "2026-08-16T10:01:00.000Z", snapshot_json: JSON.stringify({ visibility: "private", sharedWith: [] }) },
    );
    const env = { DB: db } as unknown as Parameters<typeof fetchLibraryForUser>[0];

    await expect(fetchLibraryForUser(env, "reader-1", {
      since: "2026-08-16T09:59:00.000Z", cutoff: "2026-08-16T10:03:00.000Z",
      phase: "deleted_sites", limit: 20,
    })).resolves.toMatchObject({ deletedSiteIds: ["site-revoked-deleted"] });
    await expect(fetchLibraryForUser(env, "reader-1", {
      since: "2026-08-16T09:59:00.000Z", cutoff: "2026-08-16T10:03:00.000Z",
      phase: "deleted_simulations", limit: 20,
    })).resolves.toMatchObject({ deletedSimulationIds: ["sim-revoked-deleted"] });
  });

  it("atomically rejects recreation when deletion wins after the stale-client read", async () => {
    const db = new FakeDb();
    db.sites.set("site-concurrent", {
      id: "site-concurrent",
      owner_user_id: "owner-1",
      created_at: "2026-08-14T00:00:00.000Z",
      visibility: "private",
      payload_json: JSON.stringify({ id: "site-concurrent", name: "Concurrent Site", visibility: "private" }),
    });
    db.deleteSiteBeforeGuardedWrite = "site-concurrent";
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];

    await expect(upsertLibrarySnapshot(
      env,
      { id: "owner-1", isAdmin: false, isModerator: false },
      { siteLibrary: [{ id: "site-concurrent", name: "Stale edit", visibility: "private" }], simulationPresets: [] },
    )).resolves.toMatchObject({ upsertedSites: 0, conflicts: ["site_deleted"] });
    expect(db.sites.has("site-concurrent")).toBe(false);
  });

  it("fails closed when Site ownership changes after authorization", async () => {
    const db = new FakeDb();
    db.sites.set("site-owner-race", {
      id: "site-owner-race", owner_user_id: "owner-1", created_at: "2026-08-14T00:00:00.000Z",
      visibility: "private", name: "Original", payload_json: JSON.stringify({ id: "site-owner-race", name: "Original" }),
    });
    db.mutateBeforeGuardedWrite = () => {
      db.sites.set("site-owner-race", { ...db.sites.get("site-owner-race"), owner_user_id: "owner-2" });
    };
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];

    await expect(upsertLibrarySnapshot(env, { id: "owner-1", isAdmin: false, isModerator: false }, {
      siteLibrary: [{ id: "site-owner-race", name: "Stale overwrite", visibility: "private" }], simulationPresets: [],
    })).resolves.toMatchObject({ upsertedSites: 0, conflicts: ["forbidden_site"] });
    expect(db.sites.get("site-owner-race")?.name).toBe("Original");
  });

  it("fails closed when a collaborator role is revoked after authorization", async () => {
    const db = new FakeDb();
    db.sites.set("site-role-race", {
      id: "site-role-race", owner_user_id: "owner-1", created_at: "2026-08-14T00:00:00.000Z",
      visibility: "public_write", name: "Original", payload_json: JSON.stringify({ id: "site-role-race", name: "Original" }),
    });
    db.siteRoles.set("site-role-race:editor-1", "editor");
    db.mutateBeforeGuardedWrite = () => db.siteRoles.delete("site-role-race:editor-1");
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];

    await expect(upsertLibrarySnapshot(env, { id: "editor-1", isAdmin: false, isModerator: false }, {
      siteLibrary: [{ id: "site-role-race", name: "Stale editor", visibility: "shared" }], simulationPresets: [],
    })).resolves.toMatchObject({ upsertedSites: 0, conflicts: ["forbidden_site"] });
    expect(db.sites.get("site-role-race")?.name).toBe("Original");
  });

  it("fails closed when another owner concurrently creates the requested ID", async () => {
    const db = new FakeDb();
    db.mutateBeforeGuardedWrite = () => {
      db.sites.set("site-collision", {
        id: "site-collision", owner_user_id: "owner-2", created_at: "2026-08-14T00:00:00.000Z",
        visibility: "private", name: "Other owner", payload_json: JSON.stringify({ id: "site-collision", name: "Other owner" }),
      });
    };
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];

    await expect(upsertLibrarySnapshot(env, { id: "owner-1", isAdmin: false, isModerator: false }, {
      siteLibrary: [{ id: "site-collision", name: "Colliding create", visibility: "private" }], simulationPresets: [],
    })).resolves.toMatchObject({ upsertedSites: 0, conflicts: ["forbidden_site"] });
    expect(db.sites.get("site-collision")?.owner_user_id).toBe("owner-2");
  });

  it("uses live visibility and owner state for the atomic public Site quota", async () => {
    const db = new FakeDb();
    db.sites.set("site-republish", {
      id: "site-republish", owner_user_id: "owner-1", created_at: "2026-08-14T00:00:00.000Z",
      visibility: "public_read", name: "Original", payload_json: JSON.stringify({ id: "site-republish", name: "Original" }),
    });
    db.mutateBeforeGuardedWrite = () => {
      db.sites.set("site-republish", {
        ...db.sites.get("site-republish"), owner_user_id: "owner-2", visibility: "private",
      });
      for (let index = 0; index < LIBRARY_MAX_PUBLIC_SITES_PER_USER; index += 1) {
        db.sites.set(`owner-2-public-${index}`, {
          id: `owner-2-public-${index}`, owner_user_id: "owner-2", visibility: "public_read",
          name: `Public ${index}`, payload_json: "{}",
        });
      }
    };
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];

    await expect(upsertLibrarySnapshot(env, { id: "admin-1", isAdmin: true, isModerator: false }, {
      siteLibrary: [{ id: "site-republish", name: "Republish", visibility: "public" }], simulationPresets: [],
    })).resolves.toMatchObject({ upsertedSites: 0, conflicts: ["site_quota_exceeded"] });
    expect(db.sites.get("site-republish")).toMatchObject({ owner_user_id: "owner-2", visibility: "private", name: "Original" });
  });

  it("allows an admin public Site update when the live owner remains below quota", async () => {
    const db = new FakeDb();
    db.sites.set("site-republish", {
      id: "site-republish", owner_user_id: "owner-1", created_at: "2026-08-14T00:00:00.000Z",
      visibility: "public_read", name: "Original", payload_json: JSON.stringify({ id: "site-republish", name: "Original" }),
    });
    db.mutateBeforeGuardedWrite = () => {
      db.sites.set("site-republish", {
        ...db.sites.get("site-republish"), owner_user_id: "owner-2", visibility: "private",
      });
      for (let index = 0; index < LIBRARY_MAX_PUBLIC_SITES_PER_USER - 1; index += 1) {
        db.sites.set(`owner-2-public-${index}`, {
          id: `owner-2-public-${index}`, owner_user_id: "owner-2", visibility: "public_read",
          name: `Public ${index}`, payload_json: "{}",
        });
      }
    };
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];

    await expect(upsertLibrarySnapshot(env, { id: "admin-1", isAdmin: true, isModerator: false }, {
      siteLibrary: [{ id: "site-republish", name: "Republish", visibility: "public" }], simulationPresets: [],
    })).resolves.toMatchObject({ upsertedSites: 1, conflicts: [] });
    expect(db.sites.get("site-republish")).toMatchObject({ owner_user_id: "owner-2", visibility: "public_read", name: "Republish" });
  });

  it("rejects a stale Simulation update when soft-deletion wins after the precheck", async () => {
    const db = new FakeDb();
    db.simulations.set("sim-delete-race", {
      id: "sim-delete-race", owner_user_id: "owner-1", created_at: "2026-08-14T00:00:00.000Z",
      visibility: "private", status: "active", name: "Original",
      payload_json: JSON.stringify({ id: "sim-delete-race", name: "Original" }),
    });
    db.simulationRoles.set("sim-delete-race:viewer-1", "viewer");
    db.mutateBeforeGuardedWrite = () => {
      db.simulations.set("sim-delete-race", { ...db.simulations.get("sim-delete-race"), status: "deleted" });
    };
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];

    await expect(upsertLibrarySnapshot(env, { id: "owner-1", isAdmin: false, isModerator: false }, {
      siteLibrary: [], simulationPresets: [{ id: "sim-delete-race", name: "Stale overwrite", visibility: "private" }],
    })).resolves.toMatchObject({ upsertedSimulations: 0, conflicts: ["simulation_deleted"] });
    expect(db.simulations.get("sim-delete-race")).toMatchObject({ status: "deleted", name: "Original" });
    expect(db.simulationRoles.get("sim-delete-race:viewer-1")).toBe("viewer");
  });

  it("rejects oversized batches instead of silently truncating them", async () => {
    const db = new FakeDb();
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];
    await expect(upsertLibrarySnapshot(
      env,
      { id: "owner-1", isAdmin: false, isModerator: false },
      {
        siteLibrary: Array.from({ length: LIBRARY_BATCH_MAX_RECORDS + 1 }, (_, index) => ({
          id: `site-${index}`,
          name: `Site ${index}`,
        })),
        simulationPresets: [],
      },
    )).rejects.toThrow(`at most ${LIBRARY_BATCH_MAX_RECORDS} records`);
    expect(db.sites.size).toBe(0);
  });

  it("preflights owner and public quotas before writing any record", async () => {
    const db = new FakeDb();
    for (let index = 0; index < LIBRARY_MAX_SITES_PER_USER; index += 1) {
      db.sites.set(`site-${index}`, {
        id: `site-${index}`,
        owner_user_id: "owner-1",
        name: `Site ${index}`,
        visibility: index < LIBRARY_MAX_PUBLIC_SITES_PER_USER ? "public_read" : "private",
        payload_json: JSON.stringify({ id: `site-${index}`, name: `Site ${index}` }),
      });
    }
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];

    await expect(upsertLibrarySnapshot(
      env,
      { id: "owner-1", isAdmin: false, isModerator: false },
      { siteLibrary: [{ id: "site-new", name: "New Site", visibility: "private" }], simulationPresets: [] },
    )).rejects.toThrow("Site Library quota exceeded");
    expect(db.sites.has("site-new")).toBe(false);

    await expect(upsertLibrarySnapshot(
      env,
      { id: "owner-1", isAdmin: false, isModerator: false },
      { siteLibrary: [{ id: `site-${LIBRARY_MAX_PUBLIC_SITES_PER_USER}`, name: "Existing", visibility: "public" }], simulationPresets: [] },
    )).rejects.toThrow("Public Site Library quota exceeded");
  });

  it("grandfathers over-quota owners when an update does not increase usage", async () => {
    const db = new FakeDb();
    for (let index = 0; index <= LIBRARY_MAX_SITES_PER_USER; index += 1) {
      db.sites.set(`site-${index}`, {
        id: `site-${index}`,
        owner_user_id: "owner-1",
        created_at: "2026-08-14T00:00:00.000Z",
        name: `Site ${index}`,
        visibility: "private",
        payload_json: JSON.stringify({ id: `site-${index}`, name: `Site ${index}`, visibility: "private" }),
      });
    }
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];

    await expect(upsertLibrarySnapshot(
      env,
      { id: "owner-1", isAdmin: false, isModerator: false },
      { siteLibrary: [{ id: "site-0", name: "Updated Site", visibility: "private" }], simulationPresets: [] },
    )).resolves.toMatchObject({ upsertedSites: 1, conflicts: [] });
  });

  it("fails closed if the atomic write guard detects a concurrent quota race", async () => {
    const db = new FakeDb();
    db.rejectNextQuotaGuardedWrite = true;
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];

    await expect(upsertLibrarySnapshot(
      env,
      { id: "owner-1", isAdmin: false, isModerator: false },
      { siteLibrary: [{ id: "site-race", name: "Race Site", visibility: "private" }], simulationPresets: [] },
    )).resolves.toEqual({ upsertedSites: 0, upsertedSimulations: 0, conflicts: ["site_quota_exceeded"] });
    expect(db.sites.has("site-race")).toBe(false);
  });

  it("enforces Simulation owner/public boundaries and grandfathers non-increasing updates", async () => {
    const db = new FakeDb();
    for (let index = 0; index < LIBRARY_MAX_SIMULATIONS_PER_USER; index += 1) {
      db.simulations.set(`sim-${index}`, {
        id: `sim-${index}`,
        owner_user_id: "owner-1",
        created_at: "2026-08-14T00:00:00.000Z",
        name: `Simulation ${index}`,
        visibility: index < LIBRARY_MAX_PUBLIC_SIMULATIONS_PER_USER ? "public_read" : "private",
        status: "active",
        payload_json: JSON.stringify({ id: `sim-${index}`, name: `Simulation ${index}`, visibility: "private" }),
      });
    }
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];
    const actor = { id: "owner-1", isAdmin: false, isModerator: false };

    await expect(upsertLibrarySnapshot(env, actor, {
      siteLibrary: [],
      simulationPresets: [{ id: "sim-new", name: "New Simulation", visibility: "private" }],
    })).rejects.toThrow("Simulation Library quota exceeded");
    await expect(upsertLibrarySnapshot(env, actor, {
      siteLibrary: [],
      simulationPresets: [{ id: `sim-${LIBRARY_MAX_PUBLIC_SIMULATIONS_PER_USER}`, name: "Existing Simulation", visibility: "public" }],
    })).rejects.toThrow("Public Simulation Library quota exceeded");
    await expect(upsertLibrarySnapshot(env, actor, {
      siteLibrary: [],
      simulationPresets: [{ id: "sim-0", name: "Updated Simulation", visibility: "public" }],
    })).resolves.toMatchObject({ upsertedSimulations: 1, conflicts: [] });
  });

  it("counts retained deleted Simulations toward total and public storage quotas", async () => {
    const db = new FakeDb();
    for (let index = 0; index < LIBRARY_MAX_SIMULATIONS_PER_USER; index += 1) {
      db.simulations.set(`deleted-${index}`, {
        id: `deleted-${index}`, owner_user_id: "owner-1", visibility: "private", status: "deleted",
        payload_json: JSON.stringify({ id: `deleted-${index}`, name: `Deleted ${index}` }),
      });
    }
    const env = { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0];
    const actor = { id: "owner-1", isAdmin: false, isModerator: false };

    await expect(upsertLibrarySnapshot(env, actor, {
      siteLibrary: [], simulationPresets: [{ id: "sim-new", name: "New Simulation", visibility: "private" }],
    })).rejects.toThrow("Simulation Library quota exceeded");

    db.simulations.clear();
    for (let index = 0; index < LIBRARY_MAX_PUBLIC_SIMULATIONS_PER_USER; index += 1) {
      db.simulations.set(`deleted-public-${index}`, {
        id: `deleted-public-${index}`, owner_user_id: "owner-1", visibility: "public_read", status: "deleted",
        payload_json: JSON.stringify({ id: `deleted-public-${index}`, name: `Deleted Public ${index}` }),
      });
    }
    await expect(upsertLibrarySnapshot(env, actor, {
      siteLibrary: [], simulationPresets: [{ id: "sim-public", name: "New Public", visibility: "public" }],
    })).rejects.toThrow("Public Simulation Library quota exceeded");
  });

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

  it("uses stored thumbnails for compact Library attribution DTOs", async () => {
    const db = createPrivateBundleDb();
    db.simulations.set("sim-private", {
      ...db.simulations.get("sim-private"),
      owner_avatar_url: avatarUrl,
      owner_avatar_thumb_key: avatarThumbKey,
    });
    const env = { DB: db } as unknown as Parameters<typeof fetchLibraryForUser>[0];

    const library = await fetchLibraryForUser(env, "owner-1");

    expect(library.simulationPresets[0]).toMatchObject({
      createdByAvatarUrl: avatarThumbUrl,
      lastEditedByAvatarUrl: avatarThumbUrl,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});

describe("resource change authorization", () => {
  const actor = (id: string, overrides: Partial<{ isAdmin: boolean; isModerator: boolean }> = {}) => ({
    id,
    isAdmin: false,
    isModerator: false,
    ...overrides,
  });

  const createResourceHistoryDb = () => {
    const db = new FakeDb();
    db.sites.set("site-1", {
      id: "site-1",
      owner_user_id: "owner-1",
      created_at: "2026-01-01T00:00:00.000Z",
      name: "Private Site",
      visibility: "private",
      payload_json: JSON.stringify({
        id: "site-1",
        name: "Private Site",
        visibility: "private",
        sharedWith: [
          { userId: "viewer-1", role: "viewer" },
          { userId: "editor-1", role: "editor" },
        ],
      }),
    });
    db.siteRoles.set("site-1:viewer-1", "viewer");
    db.siteRoles.set("site-1:editor-1", "editor");
    db.simulations.set("sim-1", {
      id: "sim-1",
      owner_user_id: "owner-1",
      created_at: "2026-01-01T00:00:00.000Z",
      name: "Private Simulation",
      visibility: "private",
      status: "active",
      payload_json: JSON.stringify({
        id: "sim-1",
        name: "Private Simulation",
        visibility: "private",
        sharedWith: [{ userId: "viewer-1", role: "viewer" }],
      }),
    });
    db.simulationRoles.set("sim-1:viewer-1", "viewer");
    db.resourceChanges.push(
      {
        id: 1,
        resource_kind: "site",
        resource_id: "site-1",
        action: "updated",
        actor_user_id: "owner-1",
        changed_at: "2026-01-02T00:00:00.000Z",
        note: "Moved Site",
        details_json: JSON.stringify({
          changedFields: ["name", "updatedAt"],
          diff: {
            name: {
              before: "Old Site",
              after: "Private Site",
              payload: { sites: [{ position: { lat: 60, lon: 10 } }] },
            },
            visibility: { before: "private", after: "shared" },
            status: {
              before: { value: "active", snapshot: { sites: [{ position: { lat: 60, lon: 10 } }] } },
              after: { value: "deleted" },
            },
            " name ": {
              before: { sites: [{ position: { lat: 60, lon: 10 } }] },
              after: { sites: [{ position: { lat: 61, lon: 11 } }] },
            },
            updatedAt: { before: "old", after: "new" },
            snapshot: {
              before: { sites: [{ id: "old", position: { lat: 60, lon: 10 } }] },
              after: { sites: [{ id: "new", position: { lat: 61, lon: 11 } }] },
            },
            sharedWith: {
              before: [{ userId: "former-1", role: "viewer" }],
              after: [{ userId: "viewer-1", role: "viewer" }],
            },
          },
          internal: "do-not-return",
        }),
        snapshot_json: JSON.stringify({
          id: "site-1",
          name: "Private Site",
          visibility: "private",
          sharedWith: [
            { userId: "viewer-1", role: "viewer" },
            { userId: "editor-1", role: "editor" },
          ],
          position: { lat: 60, lon: 10 },
        }),
      },
      {
        id: 2,
        resource_kind: "simulation",
        resource_id: "sim-1",
        action: "updated",
        actor_user_id: "owner-1",
        changed_at: "2026-01-02T00:00:00.000Z",
        note: "Updated Simulation",
        details_json: JSON.stringify({ diff: { name: { before: "Old", after: "Private Simulation" } } }),
        snapshot_json: JSON.stringify({
          id: "sim-1",
          name: "Private Simulation",
          visibility: "private",
          sharedWith: [{ userId: "viewer-1", role: "viewer" }],
        }),
      },
    );
    return db;
  };

  it("returns minimized Site history to current owners, collaborators, and administrators", async () => {
    const db = createResourceHistoryDb();
    const env = { DB: db } as unknown as Parameters<typeof fetchResourceChanges>[0];

    for (const currentActor of [
      actor("owner-1"),
      actor("viewer-1"),
      actor("editor-1"),
      actor("admin-1", { isAdmin: true }),
    ]) {
      const result = await fetchResourceChanges(env, "site", "site-1", currentActor);
      expect(result).toEqual({
        ok: true,
        changes: [
          {
            id: 1,
            action: "updated",
            changedAt: "2026-01-02T00:00:00.000Z",
            note: "Moved Site",
            actorUserId: "owner-1",
            actorName: "owner-1",
            actorAvatarUrl: "",
            details: {
              diff: {
                name: { before: "Old Site", after: "Private Site" },
                visibility: { before: "private", after: "shared" },
              },
            },
          },
        ],
      });
    }
  });

  it("uses current visibility and grants, including transitions and revocation", async () => {
    const db = createResourceHistoryDb();
    const env = { DB: db } as unknown as Parameters<typeof fetchResourceChanges>[0];

    await expect(fetchResourceChanges(env, "site", "site-1", actor("other-1")))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(fetchResourceChanges(env, "site", "site-1", actor("moderator-1", { isModerator: true })))
      .resolves.toEqual({ ok: false, reason: "forbidden" });

    db.sites.set("site-1", { ...db.sites.get("site-1"), visibility: "public_write" });
    await expect(fetchResourceChanges(env, "site", "site-1", actor("other-1")))
      .resolves.toMatchObject({ ok: true });
    await expect(fetchResourceChanges(env, "site", "site-1", actor("moderator-1", { isModerator: true })))
      .resolves.toMatchObject({ ok: true });

    db.sites.set("site-1", { ...db.sites.get("site-1"), visibility: "private" });
    await expect(fetchResourceChanges(env, "site", "site-1", actor("viewer-1")))
      .resolves.toMatchObject({ ok: true });
    db.siteRoles.delete("site-1:viewer-1");
    await expect(fetchResourceChanges(env, "site", "site-1", actor("viewer-1")))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
  });

  it("uses stored thumbnails for resource-change actor DTOs", async () => {
    const db = createResourceHistoryDb();
    db.users.push(userRow({ id: "owner-1", avatar_url: avatarUrl, avatar_thumb_key: avatarThumbKey }));
    const env = { DB: db } as unknown as Parameters<typeof fetchResourceChanges>[0];

    const result = await fetchResourceChanges(env, "site", "site-1", actor("owner-1"));

    expect(result).toMatchObject({
      ok: true,
      changes: [{ actorAvatarUrl: avatarThumbUrl }],
    });
  });

  it("authorizes active Simulation history and keeps deleted history administrator-only", async () => {
    const db = createResourceHistoryDb();
    const env = { DB: db } as unknown as Parameters<typeof fetchResourceChanges>[0];

    for (const currentActor of [actor("owner-1"), actor("viewer-1"), actor("admin-1", { isAdmin: true })]) {
      await expect(fetchResourceChanges(env, "simulation", "sim-1", currentActor))
        .resolves.toMatchObject({ ok: true });
    }
    await expect(fetchResourceChanges(env, "simulation", "sim-1", actor("moderator-1", { isModerator: true })))
      .resolves.toEqual({ ok: false, reason: "forbidden" });

    db.simulations.set("sim-1", { ...db.simulations.get("sim-1"), status: "deleted" });
    await expect(fetchResourceChanges(env, "simulation", "sim-1", actor("owner-1")))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(fetchResourceChanges(env, "simulation", "sim-1", actor("admin-1", { isAdmin: true })))
      .resolves.toMatchObject({ ok: true });
    await expect(revertResourceFromChangeCopy(env, "simulation", "sim-1", 2, actor("admin-1", { isAdmin: true })))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
  });

  it("requires current edit authority before loading and applying a revert snapshot", async () => {
    const db = createResourceHistoryDb();
    const env = { DB: db } as unknown as Parameters<typeof revertResourceFromChangeCopy>[0];

    await expect(revertResourceFromChangeCopy(env, "site", "site-1", 1, actor("viewer-1")))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(revertResourceFromChangeCopy(env, "site", "site-1", 1, actor("moderator-1", { isModerator: true })))
      .resolves.toEqual({ ok: false, reason: "forbidden" });
    await expect(revertResourceFromChangeCopy(env, "site", "site-1", 1, actor("editor-1")))
      .resolves.toEqual({ ok: true });
    expect(db.resourceChanges.at(-1)?.note).toBe("Revert copy from change #1");
  });

  it("does not disclose whether a missing resource has historical rows", async () => {
    const db = createResourceHistoryDb();
    db.resourceChanges.push({
      id: 3,
      resource_kind: "site",
      resource_id: "missing-site",
      action: "updated",
      actor_user_id: "owner-1",
      changed_at: "2026-01-02T00:00:00.000Z",
      note: "Orphaned history",
      details_json: null,
      snapshot_json: JSON.stringify({ id: "missing-site" }),
    });
    const env = { DB: db } as unknown as Parameters<typeof fetchResourceChanges>[0];

    await expect(fetchResourceChanges(env, "site", "missing-site", actor("admin-1", { isAdmin: true })))
      .resolves.toEqual({ ok: false, reason: "missing" });
    await expect(revertResourceFromChangeCopy(env, "site", "missing-site", 3, actor("admin-1", { isAdmin: true })))
      .resolves.toEqual({ ok: false, reason: "missing" });
  });
});
