import { parseApiErrorMessage } from "./apiError";
import { LIBRARY_BATCH_MAX_RECORDS, LIBRARY_REQUEST_MAX_BYTES } from "./libraryLimits";

export type CloudLibraryPayload = {
  siteLibrary: unknown[];
  simulationPresets: unknown[];
  deletedSimulationIds?: string[];
};

type CloudPushResult = {
  ok?: boolean;
  conflicts?: string[];
};

type TaggedLibraryRecord = { kind: "site" | "simulation"; value: unknown };

const pushBodyForRecords = (records: TaggedLibraryRecord[]): CloudLibraryPayload => ({
  siteLibrary: records.filter((entry) => entry.kind === "site").map((entry) => entry.value),
  simulationPresets: records.filter((entry) => entry.kind === "simulation").map((entry) => entry.value),
});

const buildPushBatches = (records: TaggedLibraryRecord[]): CloudLibraryPayload[] => {
  if (records.length === 0) return [pushBodyForRecords([])];
  const encoder = new TextEncoder();
  const batches: CloudLibraryPayload[] = [];
  let current: TaggedLibraryRecord[] = [];
  for (const record of records) {
    const singleRecordBytes = encoder.encode(JSON.stringify(pushBodyForRecords([record]))).byteLength;
    if (singleRecordBytes > LIBRARY_REQUEST_MAX_BYTES) {
      throw new Error(`Library record cannot fit within the ${LIBRARY_REQUEST_MAX_BYTES}-byte request limit.`);
    }
    const candidate = [...current, record];
    const candidateBody = pushBodyForRecords(candidate);
    const candidateBytes = encoder.encode(JSON.stringify(candidateBody)).byteLength;
    if (current.length > 0 && (candidate.length > LIBRARY_BATCH_MAX_RECORDS || candidateBytes > LIBRARY_REQUEST_MAX_BYTES)) {
      batches.push(pushBodyForRecords(current));
      current = [record];
      continue;
    }
    current = candidate;
  }
  batches.push(pushBodyForRecords(current));
  return batches;
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

export const deleteCloudSite = async (siteId: string): Promise<void> => {
  await apiCall(`/api/library/sites/${encodeURIComponent(siteId)}`, { method: "DELETE" });
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
  const records = [
    ...payload.siteLibrary.map((value) => ({ kind: "site" as const, value })),
    ...payload.simulationPresets.map((value) => ({ kind: "simulation" as const, value })),
  ];
  const batches = buildPushBatches(records);
  for (const batch of batches) {
    const result = await apiCall<CloudPushResult>("/api/library", {
      method: "PUT",
      body: JSON.stringify(batch),
    });
    const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
    if (!conflicts.length) continue;
    if (conflicts.includes("simulation_name_taken")) {
      const simulationNames = listSimulationNames(payload);
      const suffix = simulationNames.length ? `: ${simulationNames.join(", ")}` : "";
      throw new Error(`Simulation name already exists${suffix}. Use unique Simulation names.`);
    }
    throw new Error(`Cloud rejected ${conflicts.length} item(s): ${conflicts.join(", ")}`);
  }
};
