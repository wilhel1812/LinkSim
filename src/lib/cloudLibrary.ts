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
  console.log("[cloudLibrary] API call:", init?.method ?? "GET", path);
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  console.log("[cloudLibrary] Response:", response.status, response.statusText);
  if (!response.ok) {
    const message = await parseApiErrorMessage(response);
    console.log("[cloudLibrary] Error response:", message);
    throw new Error(`${response.status} ${response.statusText}: ${message}`);
  }
  return (await response.json()) as T;
};

export const fetchCloudLibrary = async (): Promise<CloudLibraryPayload> => {
  console.log("[cloudLibrary] Fetching cloud library...");
  const data = await apiCall<{ siteLibrary?: unknown[]; simulationPresets?: unknown[] }>("/api/library", {
    method: "GET",
  });
  console.log("[cloudLibrary] Cloud data received:", {
    sites: data.siteLibrary?.length ?? 0,
    simulations: data.simulationPresets?.length ?? 0,
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
  console.log("[cloudLibrary] Fetching public simulation:", query.toString());
  const data = await apiCall<{ siteLibrary?: unknown[]; simulationPresets?: unknown[]; simulationId?: unknown }>(
    `/api/public-simulation?${query.toString()}`,
    {
      method: "GET",
    },
  );
  console.log("[cloudLibrary] Public simulation data received:", {
    sites: data.siteLibrary?.length ?? 0,
    simulations: data.simulationPresets?.length ?? 0,
    simulationId: data.simulationId,
  });
  return {
    siteLibrary: Array.isArray(data.siteLibrary) ? data.siteLibrary : [],
    simulationPresets: Array.isArray(data.simulationPresets) ? data.simulationPresets : [],
    simulationId: typeof data.simulationId === "string" ? data.simulationId : undefined,
  };
};

export const pushCloudLibrary = async (payload: CloudLibraryPayload, opts?: { suppressConflicts?: string[] }): Promise<void> => {
  console.log("[cloudLibrary] Pushing library to cloud:", {
    sites: payload.siteLibrary.length,
    simulations: payload.simulationPresets.length,
    payloadSize: JSON.stringify(payload).length,
  });
  const result = await apiCall<CloudPushResult>("/api/library", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  console.log("[cloudLibrary] Push response:", result);
  const allConflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
  const conflicts = allConflicts.filter((c) => !(opts?.suppressConflicts ?? []).includes(c));
  if (!allConflicts.length) {
    console.log("[cloudLibrary] Push succeeded with no conflicts");
    return;
  }
  console.log("[cloudLibrary] Push has conflicts:", allConflicts, "fatal:", conflicts);
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
