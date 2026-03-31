export type CloudUser = {
  id: string;
  username: string;
  email?: string;
  bio: string;
  accessRequestNote?: string;
  idpEmail?: string;
  idpEmailVerified?: boolean;
  avatarUrl: string;
  emailPublic?: boolean;
  isAdmin: boolean;
  isModerator?: boolean;
  isApproved: boolean;
  role?: "admin" | "moderator" | "user" | "pending";
  accountState?: "pending" | "approved" | "revoked";
  approvedAt?: string | null;
  approvedByUserId?: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type ResourceChange = {
  id: number;
  action: string;
  changedAt: string;
  note: string | null;
  actorUserId: string;
  actorName: string | null;
  actorAvatarUrl: string | null;
  details?: Record<string, unknown> | null;
  snapshot?: Record<string, unknown> | null;
};

export type DeletedCloudUser = {
  id: string;
  deletedAt: string;
  deletedByUserId: string | null;
};

export type AuthDiagnostics = {
  auth: {
    source: string;
    userId: string;
    signals: {
      hasJwtAssertion: boolean;
      hasEmailHeader: boolean;
      hasUserIdHeader: boolean;
      hasUserNameHeader: boolean;
    };
    claims: {
      iss: string | null;
      sub: string | null;
      email: string | null;
      name: string | null;
      iat: number | null;
      exp: number | null;
    };
    config: {
      accessAudConfigured: boolean;
      accessTeamDomainConfigured: boolean;
      insecureDevAuthEnabled: boolean;
      authObservabilityEnabled: boolean;
    };
  };
};

export type SchemaDiagnostics = {
  schema: {
    version: string;
    ok: boolean;
    missing: Array<{ table: string; columns: string[] }>;
  };
};

export type MetadataRepairResult = {
  ok: boolean;
  sitesUpdated: number;
  simulationsUpdated: number;
};

export type OwnershipReassignResult = {
  ok: boolean;
  previousOwnerUserId: string;
  newOwnerUserId: string;
};

export type BulkOwnershipReassignResult = {
  sitesUpdated: number;
  simulationsUpdated: number;
};

export type AdminAuditEvent = {
  id: number;
  eventType: string;
  targetUserId: string;
  sourceUserId: string | null;
  actorUserId: string | null;
  idpEmail: string | null;
  detailsJson: string | null;
  createdAt: string;
};

export type AvatarUploadResult = {
  ok: boolean;
  user: CloudUser;
  avatar: {
    url: string;
    objectKey: string;
    thumbKey: string;
    hash: string;
    contentType: string;
    bytes: number;
  };
};

export type CollaboratorDirectoryUser = {
  id: string;
  username: string;
  email: string;
  avatarUrl: string;
};

export type DeepLinkStatus = "ok" | "forbidden" | "missing";
export type DeepLinkStatusResult = { status: DeepLinkStatus; simulationId?: string; authenticated?: boolean };

const apiCall = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers ?? {});
  const hasBody = init?.body !== undefined && init.body !== null;
  if (hasBody && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const raw = await response.text();
    let message = raw;
    try {
      const parsed = JSON.parse(raw) as { error?: unknown };
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        message = parsed.error.trim();
      }
    } catch {
      // Keep raw fallback.
    }
    throw new Error(`${response.status} ${response.statusText}: ${message}`);
  }
  return (await response.json()) as T;
};

const ME_CACHE_TTL_MS = 30_000;
let meCache: { user: CloudUser; expiresAt: number } | null = null;

export const clearMeCache = (): void => {
  meCache = null;
};

export const fetchMe = async (): Promise<CloudUser> => {
  const now = Date.now();
  if (meCache && now < meCache.expiresAt) {
    return meCache.user;
  }
  const data = await apiCall<{ user: CloudUser }>("/api/me", { method: "GET" });
  meCache = { user: data.user, expiresAt: now + ME_CACHE_TTL_MS };
  return data.user;
};

export const fetchUserById = async (id: string): Promise<CloudUser> => {
  const data = await apiCall<{ user: CloudUser }>(`/api/users/${encodeURIComponent(id)}`, { method: "GET" });
  return data.user;
};

export const updateMyProfile = async (patch: {
  username?: string;
  email?: string;
  bio?: string;
  accessRequestNote?: string;
  avatarUrl?: string;
  emailPublic?: boolean;
}): Promise<CloudUser> => {
  const data = await apiCall<{ user: CloudUser }>("/api/me", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  clearMeCache();
  return data.user;
};

export const fetchUsers = async (): Promise<CloudUser[]> => {
  const data = await apiCall<{ users: CloudUser[] }>("/api/users", { method: "GET" });
  return Array.isArray(data.users) ? data.users : [];
};

export const fetchCollaboratorDirectory = async (): Promise<CollaboratorDirectoryUser[]> => {
  const data = await apiCall<{ users: CollaboratorDirectoryUser[] }>("/api/collaborator-directory", {
    method: "GET",
  });
  return Array.isArray(data.users) ? data.users : [];
};

export const updateUserAdmin = async (id: string, isAdmin: boolean): Promise<CloudUser> => {
  const data = await apiCall<{ user: CloudUser }>(`/api/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ isAdmin }),
  });
  return data.user;
};

export const updateUserRole = async (
  id: string,
  role: "admin" | "moderator" | "user" | "pending",
): Promise<CloudUser> => {
  const data = await apiCall<{ user: CloudUser }>(`/api/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
  return data.user;
};

export const updateUserApproval = async (id: string, isApproved: boolean): Promise<CloudUser> => {
  const data = await apiCall<{ user: CloudUser }>(`/api/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ isApproved }),
  });
  return data.user;
};

export const updateUserProfile = async (
  id: string,
  patch: {
    username?: string;
    email?: string;
    bio?: string;
    accessRequestNote?: string;
    avatarUrl?: string;
    emailPublic?: boolean;
  },
): Promise<CloudUser> => {
  const data = await apiCall<{ user: CloudUser }>(`/api/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return data.user;
};

export const deleteUser = async (id: string): Promise<void> => {
  await apiCall<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
};

export const fetchResourceChanges = async (
  kind: "site" | "simulation",
  id: string,
): Promise<ResourceChange[]> => {
  const params = new URLSearchParams({ kind, id });
  const data = await apiCall<{ changes: ResourceChange[] }>(`/api/changes?${params.toString()}`, {
    method: "GET",
  });
  return Array.isArray(data.changes) ? data.changes : [];
};

export const revertResourceChangeCopy = async (
  kind: "site" | "simulation",
  id: string,
  changeId: number,
): Promise<void> => {
  await apiCall<{ ok: boolean }>("/api/changes", {
    method: "POST",
    body: JSON.stringify({ kind, id, changeId }),
  });
};

export const fetchDeletedUsers = async (): Promise<DeletedCloudUser[]> => {
  const data = await apiCall<{ users: DeletedCloudUser[] }>("/api/deleted-users", { method: "GET" });
  return Array.isArray(data.users) ? data.users : [];
};

export const restoreDeletedCloudUser = async (id: string): Promise<void> => {
  const params = new URLSearchParams({ id });
  await apiCall<{ ok: boolean }>(`/api/deleted-users?${params.toString()}`, { method: "DELETE" });
};

export const fetchAuthDiagnostics = async (): Promise<AuthDiagnostics> =>
  apiCall<AuthDiagnostics>("/api/auth-diagnostics", { method: "GET" });

export const fetchSchemaDiagnostics = async (): Promise<SchemaDiagnostics> =>
  apiCall<SchemaDiagnostics>("/api/schema-diagnostics", { method: "GET" });

export const runMetadataRepair = async (): Promise<MetadataRepairResult> =>
  apiCall<MetadataRepairResult>("/api/admin-repair-metadata", { method: "POST" });

export const reassignResourceOwner = async (
  kind: "site" | "simulation",
  resourceId: string,
  newOwnerUserId: string,
): Promise<OwnershipReassignResult> => {
  const data = await apiCall<{ ok: boolean; action: string; result: OwnershipReassignResult }>(
    "/api/admin-ownership-tools",
    {
      method: "POST",
      body: JSON.stringify({
        action: "reassign_owner",
        kind,
        resourceId,
        newOwnerUserId,
      }),
    },
  );
  return data.result;
};

export const bulkReassignOwnership = async (
  fromUserId: string,
  toUserId: string,
): Promise<BulkOwnershipReassignResult> => {
  const data = await apiCall<{ ok: boolean; action: string; result: BulkOwnershipReassignResult }>(
    "/api/admin-ownership-tools",
    {
      method: "POST",
      body: JSON.stringify({
        action: "bulk_reassign",
        fromUserId,
        toUserId,
      }),
    },
  );
  return data.result;
};

export const fetchAdminAuditEvents = async (limit = 60): Promise<AdminAuditEvent[]> => {
  const params = new URLSearchParams({ limit: String(limit) });
  const data = await apiCall<{ events: AdminAuditEvent[] }>(`/api/admin-audit-events?${params.toString()}`, {
    method: "GET",
  });
  return Array.isArray(data.events) ? data.events : [];
};

export const uploadAvatar = async (originalDataUrl: string, thumbDataUrl: string): Promise<AvatarUploadResult> =>
  apiCall<AvatarUploadResult>("/api/avatar-upload", {
    method: "POST",
    body: JSON.stringify({
      originalDataUrl,
      thumbDataUrl,
    }),
  });

export const fetchDeepLinkStatus = async (input: {
  simulationId?: string;
  simulationSlug?: string;
}): Promise<DeepLinkStatusResult> => {
  const params = new URLSearchParams();
  if (input.simulationId?.trim()) params.set("sim", input.simulationId.trim());
  if (input.simulationSlug?.trim()) params.set("slug", input.simulationSlug.trim());
  const data = await apiCall<{ status?: unknown; simulationId?: unknown; authenticated?: unknown }>(
    `/api/deep-link-status?${params.toString()}`,
    { method: "GET" },
  );
  const status = data.status;
  const normalized: DeepLinkStatus =
    status === "ok" || status === "forbidden" || status === "missing" ? status : "missing";
  return {
    status: normalized,
    simulationId: typeof data.simulationId === "string" && data.simulationId.trim() ? data.simulationId : undefined,
    authenticated: data.authenticated === true,
  };
};

export const setLocalDevRole = async (role: "admin" | "moderator" | "user" | "pending"): Promise<CloudUser> => {
  const data = await apiCall<{ ok: boolean; user: CloudUser }>("/api/dev-role", {
    method: "POST",
    body: JSON.stringify({ role }),
  });
  return data.user;
};
