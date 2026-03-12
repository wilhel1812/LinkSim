export type CloudLibraryPayload = {
  siteLibrary: unknown[];
  simulationPresets: unknown[];
};

const apiCall = async <T>(token: string, path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${message}`);
  }
  return (await response.json()) as T;
};

export const fetchCloudLibrary = async (token: string): Promise<CloudLibraryPayload> => {
  const data = await apiCall<{ siteLibrary?: unknown[]; simulationPresets?: unknown[] }>(token, "/api/library", {
    method: "GET",
  });
  return {
    siteLibrary: Array.isArray(data.siteLibrary) ? data.siteLibrary : [],
    simulationPresets: Array.isArray(data.simulationPresets) ? data.simulationPresets : [],
  };
};

export const pushCloudLibrary = async (token: string, payload: CloudLibraryPayload): Promise<void> => {
  await apiCall(token, "/api/library", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
};
