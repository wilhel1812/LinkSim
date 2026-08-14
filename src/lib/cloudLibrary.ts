import { parseApiErrorMessage } from "./apiError";
import { LIBRARY_BATCH_MAX_RECORDS, LIBRARY_REQUEST_MAX_BYTES } from "./libraryLimits";

export type CloudLibraryPayload = {
  siteLibrary: unknown[];
  simulationPresets: unknown[];
  deletedSiteIds?: string[];
  deletedSimulationIds?: string[];
  syncCutoff?: string;
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

type CloudLibraryPage = CloudLibraryPayload & {
  isDelta?: boolean;
  nextCursor?: string;
};

const validIds = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
  : [];

const recordId = (value: unknown): string | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id : undefined;
};

const drainLibraryPages = async (initialUrl: string): Promise<CloudLibraryPage> => {
  const sites = new Map<string, unknown>();
  const simulations = new Map<string, unknown>();
  const anonymousSites: unknown[] = [];
  const anonymousSimulations: unknown[] = [];
  const deletedSites = new Set<string>();
  const deletedSimulations = new Set<string>();
  const seenCursors = new Set<string>();
  let url: string | undefined = initialUrl;
  let syncCutoff: string | undefined;
  let isDelta: boolean | undefined;

  while (url) {
    const page: CloudLibraryPage = await apiCall(url, { method: "GET" });
    if (isDelta === undefined) isDelta = page.isDelta;
    if (typeof page.syncCutoff === "string" && page.syncCutoff) {
      if (syncCutoff && syncCutoff !== page.syncCutoff) throw new Error("Library pagination cutoff changed between pages.");
      syncCutoff = page.syncCutoff;
    }
    for (const entry of Array.isArray(page.siteLibrary) ? page.siteLibrary : []) {
      const id = recordId(entry);
      if (id) { sites.set(id, entry); deletedSites.delete(id); } else anonymousSites.push(entry);
    }
    for (const entry of Array.isArray(page.simulationPresets) ? page.simulationPresets : []) {
      const id = recordId(entry);
      if (id) { simulations.set(id, entry); deletedSimulations.delete(id); } else anonymousSimulations.push(entry);
    }
    for (const id of validIds(page.deletedSiteIds)) { deletedSites.add(id); sites.delete(id); }
    for (const id of validIds(page.deletedSimulationIds)) { deletedSimulations.add(id); simulations.delete(id); }
    const cursor = typeof page.nextCursor === "string" && page.nextCursor ? page.nextCursor : undefined;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new Error("Library pagination cursor repeated.");
      seenCursors.add(cursor);
      url = `/api/library?cursor=${encodeURIComponent(cursor)}`;
    } else {
      url = undefined;
    }
  }

  return {
    siteLibrary: [...anonymousSites, ...sites.values()],
    simulationPresets: [...anonymousSimulations, ...simulations.values()],
    deletedSiteIds: [...deletedSites],
    deletedSimulationIds: [...deletedSimulations],
    ...(syncCutoff ? { syncCutoff } : {}),
    ...(isDelta !== undefined ? { isDelta } : {}),
  };
};

const mergeLibraryPayloads = (base: CloudLibraryPage, recovery: CloudLibraryPage): CloudLibraryPage => {
  const sites = new Map<string, unknown>();
  const simulations = new Map<string, unknown>();
  const deletedSites = new Set(validIds(base.deletedSiteIds));
  const deletedSimulations = new Set(validIds(base.deletedSimulationIds));
  for (const item of base.siteLibrary) { const id = recordId(item); if (id) sites.set(id, item); }
  for (const item of base.simulationPresets) { const id = recordId(item); if (id) simulations.set(id, item); }
  for (const item of recovery.siteLibrary) {
    const id = recordId(item); if (id) { sites.set(id, item); deletedSites.delete(id); }
  }
  for (const item of recovery.simulationPresets) {
    const id = recordId(item); if (id) { simulations.set(id, item); deletedSimulations.delete(id); }
  }
  for (const id of validIds(recovery.deletedSiteIds)) { deletedSites.add(id); sites.delete(id); }
  for (const id of validIds(recovery.deletedSimulationIds)) { deletedSimulations.add(id); simulations.delete(id); }
  for (const id of deletedSites) sites.delete(id);
  for (const id of deletedSimulations) simulations.delete(id);
  return {
    siteLibrary: [...sites.values()], simulationPresets: [...simulations.values()],
    deletedSiteIds: [...deletedSites], deletedSimulationIds: [...deletedSimulations],
    syncCutoff: recovery.syncCutoff, isDelta: base.isDelta,
  };
};

export const fetchCloudLibrary = async (opts?: { since?: string }): Promise<CloudLibraryPayload & { deletedSiteIds: string[]; deletedSimulationIds: string[]; isDelta?: boolean }> => {
  const initialUrl = opts?.since ? `/api/library?since=${encodeURIComponent(opts.since)}` : "/api/library";
  const base = await drainLibraryPages(initialUrl);
  // Older/test servers without a cutoff remain compatible and cannot offer recovery.
  if (!base.syncCutoff) return base as CloudLibraryPayload & { deletedSiteIds: string[]; deletedSimulationIds: string[]; isDelta?: boolean };
  const recovery = await drainLibraryPages(`/api/library?since=${encodeURIComponent(base.syncCutoff)}`);
  return mergeLibraryPayloads(base, recovery) as CloudLibraryPayload & { deletedSiteIds: string[]; deletedSimulationIds: string[]; isDelta?: boolean };
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
