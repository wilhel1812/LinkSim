import { describe, expect, it } from "vitest";
import type { ProfilePoint } from "../types/radio";
import { buildHoverProfileSegments } from "./profileHoverSegments";

const profile: ProfilePoint[] = [
  { distanceKm: 0, lat: 0, lon: 0, terrainM: 100, losM: 105, fresnelTopM: 105, fresnelBottomM: 105 },
  { distanceKm: 1, lat: 0, lon: 1, terrainM: 110, losM: 110, fresnelTopM: 110, fresnelBottomM: 110 },
  { distanceKm: 2, lat: 0, lon: 2, terrainM: 120, losM: 115, fresnelTopM: 115, fresnelBottomM: 115 },
];

describe("buildHoverProfileSegments", () => {
  it("returns a full-path segment when cursor is at the endpoint", () => {
    const segments = buildHoverProfileSegments(profile, 2, 5, 7, 900);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.id).toBe("from-to-cursor");
    expect(segments[0]?.points).toHaveLength(3);
    expect(segments[0]?.points[0]?.losM).toBeCloseTo(105, 6);
    expect(segments[0]?.points[2]?.losM).toBeCloseTo(127, 6);
  });

  it("returns split segments when cursor is in the middle", () => {
    const segments = buildHoverProfileSegments(profile, 1, 5, 7, 900);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.id).toBe("from-to-cursor");
    expect(segments[1]?.id).toBe("to-to-cursor");

    const fromToCursor = segments[0]?.points ?? [];
    const toToCursor = segments[1]?.points ?? [];
    expect(fromToCursor[1]?.losM).toBeCloseTo(117, 6);
    expect(toToCursor[0]?.losM).toBeCloseTo(115, 6);
    expect(toToCursor[1]?.losM).toBeCloseTo(127, 6);
  });

  it("keeps Fresnel radius at segment endpoints", () => {
    const segments = buildHoverProfileSegments(profile, 1, 5, 7, 900);
    const fromToCursor = segments[0]?.points ?? [];
    const toToCursor = segments[1]?.points ?? [];

    expect(fromToCursor[0]?.fresnelTopM).toBeCloseTo(fromToCursor[0]?.losM ?? 0, 6);
    expect(fromToCursor[1]?.fresnelTopM).toBeCloseTo(fromToCursor[1]?.losM ?? 0, 6);
    expect(toToCursor[0]?.fresnelTopM).toBeCloseTo(toToCursor[0]?.losM ?? 0, 6);
    expect(toToCursor[1]?.fresnelTopM).toBeCloseTo(toToCursor[1]?.losM ?? 0, 6);
  });
});
