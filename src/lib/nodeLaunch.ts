import type { Coordinates } from "../types/radio";

export const parse868NodeLaunch = ({ pathname, search }: Pick<Location, "pathname" | "search">): string | null | undefined => {
  const params = new URLSearchParams(search);
  if (pathname !== "/" || !params.getAll("source").includes("868-no")) return undefined;
  const nodeId = params.get("node");
  return params.getAll("source").length === 1 && params.getAll("node").length === 1 &&
    nodeId && /^![0-9a-f]{8}$/i.test(nodeId) ? nodeId.toLowerCase() : null;
};

export const matchesMqttSite = (
  site: { position: Coordinates; sourceMeta?: { sourceType: string; nodeId?: string } },
  nodeId: string,
  position: Coordinates,
): boolean =>
  (site.sourceMeta?.sourceType === "mqtt-feed" && site.sourceMeta.nodeId === nodeId) ||
  (Math.abs(site.position.lat - position.lat) < 0.00001 && Math.abs(site.position.lon - position.lon) < 0.00001);
