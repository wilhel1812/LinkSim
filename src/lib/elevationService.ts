import type { Coordinates } from "../types/radio";

const CHUNK_SIZE = 50;

const chunk = <T>(input: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < input.length; i += size) out.push(input.slice(i, i + size));
  return out;
};

type ElevationResponse = {
  elevation: number[];
};

export const fetchElevations = async (coordinates: Coordinates[]): Promise<number[]> => {
  if (!coordinates.length) return [];

  const groups = chunk(coordinates, CHUNK_SIZE);
  const elevations: number[] = [];

  for (const group of groups) {
    const lat = group.map((c) => c.lat.toFixed(6)).join(",");
    const lon = group.map((c) => c.lon.toFixed(6)).join(",");
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Elevation API failed with status ${response.status}`);
    }

    const payload = (await response.json()) as ElevationResponse;
    elevations.push(...payload.elevation);
  }

  return elevations;
};
