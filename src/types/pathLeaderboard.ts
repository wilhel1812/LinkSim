export type PathLeaderboardCandidate = {
  simulationId: string;
  simulationUpdatedAt: string;
  fromSiteId: string;
  toSiteId: string;
  linkId?: string | null;
  distanceKm: number;
  rxAfterEnvLossDbm: number;
  rxMarginDb: number;
  terrainObstructed: boolean;
  terrainDataset: string;
  terrainTileSignature: string;
};

export type PathLeaderboardSubmitResult = {
  ok: boolean;
  stored: boolean;
  reason?: string;
};


/** Well-formed submissions that no longer qualify for the optional leaderboard. */
export const isExpectedPathLeaderboardRejection = (reason: unknown): boolean =>
  typeof reason === "string" && ["stale_simulation", "missing_link", "link_endpoint_mismatch", "not_passing"].includes(reason);
