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

export const fetchPublicSimulationLibrary = async (params: {
  simulationId?: string;
  simulationSlug?: string;
}): Promise<CloudLibraryPayload & { simulationId?: string }> => {
  const query = new URLSearchParams();
  if (params.simulationId?.trim()) query.set("sim", params.simulationId.trim());
  if (params.simulationSlug?.trim()) query.set("slug", params.simulationSlug.trim());
  const data = await apiCall<{ siteLibrary?: unknown[]; simulationPresets?: unknown[]; simulationId?: unknown }>(
    `/api/public-simulation?${query.toString()}`,
    {
      method: "GET",
    },
  );
  return {
    siteLibrary: Array.isArray(data.siteLibrary) ? data.siteLibrary : [],
    simulationPresets: Array.isArray(data.simulationPresets) ? data.simulationPresets : [],
    simulationId: typeof data.simulationId === "string" ? data.simulationId : undefined,
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
  if (conflicts.includes("simulation_name_taken")) {
    throw new Error("Simulation name already exists. Use a unique simulation name.");
  }
  throw new Error(`Cloud rejected ${conflicts.length} item(s): ${conflicts.join(", ")}`);
};
