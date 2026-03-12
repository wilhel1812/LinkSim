import { parseApiErrorMessage } from "./apiError";

export type CloudLibraryPayload = {
  siteLibrary: unknown[];
  simulationPresets: unknown[];
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
    const message = await parseApiErrorMessage(response);
    throw new Error(`${response.status} ${response.statusText}: ${message}`);
  }
  return (await response.json()) as T;
};

export const fetchCloudLibrary = async (): Promise<CloudLibraryPayload> => {
  const data = await apiCall<{ siteLibrary?: unknown[]; simulationPresets?: unknown[] }>("/api/library", {
    method: "GET",
  });
  return {
    siteLibrary: Array.isArray(data.siteLibrary) ? data.siteLibrary : [],
    simulationPresets: Array.isArray(data.simulationPresets) ? data.simulationPresets : [],
  };
};

export const pushCloudLibrary = async (payload: CloudLibraryPayload): Promise<void> => {
  await apiCall("/api/library", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
};
