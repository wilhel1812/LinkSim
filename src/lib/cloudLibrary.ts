import { parseApiErrorMessage } from "./apiError";

export type CloudLibraryPayload = {
  siteLibrary: unknown[];
  simulationPresets: unknown[];
};

type CloudPushResult = {
  ok?: boolean;
  conflicts?: string[];
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
  const result = await apiCall<CloudPushResult>("/api/library", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
  if (!conflicts.length) return;
  if (conflicts.includes("simulation_private_site_reference")) {
    throw new Error(
      "Cannot publish/shared a simulation that references private library sites. Set simulation to Private or use non-private site entries.",
    );
  }
  throw new Error(`Cloud rejected ${conflicts.length} item(s): ${conflicts.join(", ")}`);
};
