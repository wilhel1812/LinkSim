#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const sourcePath = path.join(root, "src", "data", "openPeakMapIndex.ts");
const outDir = path.join(root, "public", "peak-tiles", "v1");
const tileDeg = 1;

const readOpenPeakMapIndex = async () => {
  const src = await fs.readFile(sourcePath, "utf8");
  const transformed = src
    .replace(/export type[\s\S]*?\n};/g, "")
    .replace(/export const\s+(\w+)\s*:\s*[^=]+\s*=/g, "globalThis.$1 =")
    .replace(/export const\s+/g, "globalThis.")
    .replace(/\sas const;/g, ";");
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(transformed, sandbox, { filename: sourcePath });
  const buckets = sandbox.globalThis.OPEN_PEAK_MAP_INDEX_BUCKETS;
  if (!buckets || typeof buckets !== "object") throw new Error("Failed to read OPEN_PEAK_MAP_INDEX_BUCKETS");
  return Object.values(buckets).flat();
};

const tileKeyPart = (prefix, index) => `${prefix}_${index < 0 ? "m" : "p"}${Math.abs(index)}`;
const tileKeyFor = (lat, lon) => {
  const latIndex = Math.floor(lat / tileDeg);
  const lonIndex = Math.floor(lon / tileDeg);
  return `${tileKeyPart("la", latIndex)}_${tileKeyPart("lo", lonIndex)}`;
};

const main = async () => {
  const entries = await readOpenPeakMapIndex();
  const tiles = new Map();
  let norwayCount = 0;

  for (const entry of entries) {
    const lat = Number(entry.lat);
    const lon = Number(entry.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (!entry.name) continue;
    if (lat >= 57 && lat <= 72 && lon >= 4 && lon <= 32) norwayCount += 1;

    const tileKey = tileKeyFor(lat, lon);
    const tile = tiles.get(tileKey) ?? [];
    tile.push({
      id: String(entry.id),
      kind: "peak",
      name: String(entry.name),
      lat,
      lon,
      elevationM: Number.isFinite(entry.elevationM) ? Number(entry.elevationM) : null,
    });
    tiles.set(tileKey, tile);
  }

  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(path.join(outDir, "tiles"), { recursive: true });

  const version = "v1-bootstrap";
  for (const [tileKey, tileEntries] of tiles.entries()) {
    await fs.writeFile(
      path.join(outDir, "tiles", `${tileKey}.json`),
      JSON.stringify({ tileKey, version, entries: tileEntries }),
      "utf8",
    );
  }

  const manifest = {
    version,
    generatedAt: new Date().toISOString(),
    tileDeg,
    tileUrlTemplate: "/peak-tiles/v1/tiles/{tileKey}.json",
    ttlSeconds: 60 * 60 * 24 * 30,
    source: {
      provider: "osm",
      includeNatural: ["peak", "volcano"],
      namedOnly: true,
      note: "bootstrap tiles generated from existing local index; replace with global OSM pipeline output",
    },
    benchmark: {
      norwayNamedCount: norwayCount,
      minimumRequired: 1000,
      pass: norwayCount >= 1000,
    },
    stats: {
      featureCount: entries.length,
      tileCount: tiles.size,
    },
    availableTileKeys: [...tiles.keys()].sort((a, b) => a.localeCompare(b)),
  };

  await fs.writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`[peaks:bootstrap] wrote ${entries.length} entries into ${tiles.size} tiles`);
  console.log(`[peaks:bootstrap] Norway benchmark: ${norwayCount} (pass=${norwayCount >= 1000})`);
};

main().catch((error) => {
  console.error("[peaks:bootstrap] failed", error);
  process.exitCode = 1;
});
