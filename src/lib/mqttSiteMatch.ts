import type { Coordinates } from "../types/radio";

export const matchesMqttSite = (
  site: { position: Coordinates; sourceMeta?: { sourceType: string; nodeId?: string } },
  nodeId: string,
  position: Coordinates,
): boolean =>
  (site.sourceMeta?.sourceType === "mqtt-feed" && site.sourceMeta.nodeId === nodeId) ||
  (Math.abs(site.position.lat - position.lat) < 0.00001 && Math.abs(site.position.lon - position.lon) < 0.00001);
