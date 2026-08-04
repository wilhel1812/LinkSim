import { parseApiErrorMessage } from "./apiError";

export type CloudLibraryPayload = {
  siteLibrary: unknown[];
  simulationPresets: unknown[];
  deletedSimulationIds?: string[];
};

type CloudPushResult = {
  ok?: boolean;
  conflicts?: string[];
};

const listSimulationNames = (payload: CloudLibraryPayload): string[] =>
  payload.simulationPresets
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const candidate = (entry as { name?: unknown }).name;
      return typeof candidate === "string" ? candidate.trim() : "";
    })
    .filter(Boolean);

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

export const fetchCloudLibrary = async (opts?: { since?: string }): Promise<CloudLibraryPayload & { deletedSimulationIds: string[]; isDelta?: boolean }> => {
  const url = opts?.since ? `/api/library?since=${encodeURIComponent(opts.since)}` : "/api/library";
  const data = await apiCall<{ siteLibrary?: unknown[]; simulationPresets?: unknown[]; deletedSimulationIds?: unknown[]; isDelta?: boolean }>(url, {
    method: "GET",
  });
  return {
    siteLibrary: Array.isArray(data.siteLibrary) ? data.siteLibrary : [],
    simulationPresets: Array.isArray(data.simulationPresets) ? data.simulationPresets : [],
    deletedSimulationIds: Array.isArray(data.deletedSimulationIds)
      ? data.deletedSimulationIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [],
    isDelta: data.isDelta,
  };
};

export const deleteCloudSimulation = async (simulationId: string): Promise<void> => {
  await apiCall(`/api/library/simulations/${encodeURIComponent(simulationId)}`, { method: "DELETE" });
};

export const restoreCloudSimulation = async (simulationId: string): Promise<void> => {
  await apiCall(`/api/library/simulations/${encodeURIComponent(simulationId)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active" }),
  });
};

export const fetchPublicSimulationLibrary = async (params: {
  simulationId?: string;
  username?: string;
  simulationSlug?: string;
}): Promise<CloudLibraryPayload & { simulationId?: string }> => {
  const query = new URLSearchParams();
  if (params.simulationId?.trim()) query.set("sim", params.simulationId.trim());
  if (params.username?.trim()) query.set("username", params.username.trim());
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
  const allConflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
  if (!allConflicts.length) return;
  if (allConflicts.includes("simulation_name_taken")) {
    const simulationNames = listSimulationNames(payload);
    const suffix = simulationNames.length ? `: ${simulationNames.join(", ")}` : "";
    throw new Error(`Simulation name already exists${suffix}. Use unique Simulation names.`);
  }
  throw new Error(`Cloud rejected ${allConflicts.length} item(s): ${allConflicts.join(", ")}`);
};
