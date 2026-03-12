export type CloudUser = {
  id: string;
  username: string;
  email?: string;
  bio: string;
  avatarUrl: string;
  isAdmin: boolean;
  isApproved: boolean;
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
};

const apiCall = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${message}`);
  }
  return (await response.json()) as T;
};

export const fetchMe = async (): Promise<CloudUser> => {
  const data = await apiCall<{ user: CloudUser }>("/api/me", { method: "GET" });
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
  avatarUrl?: string;
}): Promise<CloudUser> => {
  const data = await apiCall<{ user: CloudUser }>("/api/me", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return data.user;
};

export const fetchUsers = async (): Promise<CloudUser[]> => {
  const data = await apiCall<{ users: CloudUser[] }>("/api/users", { method: "GET" });
  return Array.isArray(data.users) ? data.users : [];
};

export const updateUserAdmin = async (id: string, isAdmin: boolean): Promise<CloudUser> => {
  const data = await apiCall<{ user: CloudUser }>(`/api/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ isAdmin }),
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
  patch: { username?: string; email?: string; bio?: string; avatarUrl?: string },
): Promise<CloudUser> => {
  const data = await apiCall<{ user: CloudUser }>(`/api/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return data.user;
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
