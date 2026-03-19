export const shouldOpenShareModal = (
  simulationVisibility: "private" | "public" | "shared",
  privateSiteCount: number,
): boolean => simulationVisibility === "private" || privateSiteCount > 0;
