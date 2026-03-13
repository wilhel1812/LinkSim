const tileKey = (lat: number, lon: number): string => {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${ns}${String(Math.floor(Math.abs(lat))).padStart(2, "0")}${ew}${String(Math.floor(Math.abs(lon))).padStart(3, "0")}`;
};

export const tilesForBounds = (
  minLat: number,
  maxLat: number,
  minLon: number,
  maxLon: number,
): string[] => {
  const keys = new Set<string>();
  const latStart = Math.floor(minLat);
  const latEnd = Math.floor(maxLat);
  const lonStart = Math.floor(minLon);
  const lonEnd = Math.floor(maxLon);

  for (let lat = latStart; lat <= latEnd; lat += 1) {
    for (let lon = lonStart; lon <= lonEnd; lon += 1) {
      keys.add(tileKey(lat, lon));
    }
  }
  return Array.from(keys).sort();
};
