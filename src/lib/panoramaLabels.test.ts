import { describe, expect, it } from "vitest";
import { resolveVisiblePanoramaLabels, type PanoramaLabelCandidate } from "./panoramaLabels";

const mkCandidate = (id: string, source: "poi" | "peak", x: number, distanceKm: number, name = id): PanoramaLabelCandidate => ({
  id,
  source,
  name,
  x,
  y: 100,
  distanceKm,
  priorityBucket: source === "poi" ? 0 : 1,
});

describe("resolveVisiblePanoramaLabels", () => {
  it("prioritizes POIs before peaks", () => {
    const labels = resolveVisiblePanoramaLabels({
      candidates: [
        mkCandidate("peak-1", "peak", 120, 2),
        mkCandidate("poi-1", "poi", 122, 6),
      ],
      chartWidth: 360,
      leftPadding: 40,
      rightPadding: 20,
      topY: 16,
      minGapPx: 6,
    });
    expect(labels[0]?.id).toBe("poi-1");
    expect(labels.some((label) => label.id === "peak-1")).toBe(false);
  });

  it("uses nearest-first ordering within each priority bucket", () => {
    const labels = resolveVisiblePanoramaLabels({
      candidates: [
        mkCandidate("poi-far", "poi", 80, 50),
        mkCandidate("poi-near", "poi", 160, 4),
      ],
      chartWidth: 900,
      leftPadding: 40,
      rightPadding: 20,
      topY: 16,
      minGapPx: 0,
    });
    expect(labels.findIndex((label) => label.id === "poi-near")).toBeLessThan(labels.findIndex((label) => label.id === "poi-far"));
  });

  it("never exceeds horizontal room budget", () => {
    const labels = resolveVisiblePanoramaLabels({
      candidates: Array.from({ length: 30 }, (_, index) => mkCandidate(`poi-${index}`, "poi", 48 + index * 8, index + 1, `Name ${index}`)),
      chartWidth: 420,
      leftPadding: 46,
      rightPadding: 20,
      topY: 16,
    });
    expect(labels.length).toBeLessThan(10);
    for (let i = 1; i < labels.length; i += 1) {
      expect(labels[i].anchorX).toBeGreaterThanOrEqual(labels[i - 1].anchorX);
    }
  });
});

