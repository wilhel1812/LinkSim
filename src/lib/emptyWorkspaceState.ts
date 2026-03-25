export type EmptyWorkspaceState = "ready" | "no-simulation" | "blank-simulation";

export const emptyWorkspaceState = (sitesCount: number, hasActiveSimulation: boolean): EmptyWorkspaceState => {
  if (sitesCount > 0) return "ready";
  return hasActiveSimulation ? "blank-simulation" : "no-simulation";
};
