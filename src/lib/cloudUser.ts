export type CloudUser = {
  id: string;
  username: string;
  email: string;
  bio: string;
  avatarUrl: string;
  isAdmin: boolean;
  createdAt: string;
  updatedAt: string | null;
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
