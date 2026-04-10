#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
const getArg = (name, fallback = undefined) => {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  return args[index + 1] ?? fallback;
};

const input = getArg("--input");
const outDir = getArg("--out", path.join("public", "peak-tiles", "v1"));
const tileDeg = Number(getArg("--tile-deg", "1"));
const minNorway = Number(getArg("--norway-min", "1000"));
const generatedVersion = getArg("--version", `v1-${Date.now()}`);

if (!input) {
  console.error("Usage: node scripts/build-osm-peak-tiles.mjs --input <planet-or-region.osm.pbf> [--out public/peak-tiles/v1]");
  process.exit(1);
}

const root = process.cwd();
const extractScript = path.join(root, "scripts", "extract_osm_peaks.py");
const ndjsonPath = path.join(os.tmpdir(), `osm-peaks-${Date.now()}.ndjson`);

const run = (cmd, argv) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });

const tileIdFor = (lat, lon) => `${Math.floor(lat / tileDeg)}:${Math.floor(lon / tileDeg)}`;

const main = async () => {
  await run("python3", [extractScript, "--input", input, "--output", ndjsonPath]);

  const tiles = new Map();
  let featureCount = 0;
  let norwayNamedCount = 0;

  const rl = readline.createInterface({
    input: (await import("node:fs")).createReadStream(ndjsonPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const text = line.trim();
    if (!text) continue;
    const item = JSON.parse(text);
    if (!item?.name || !item?.id) continue;
    if ((item.kind !== "peak" && item.kind !== "volcano") || !Number.isFinite(item.lat) || !Number.isFinite(item.lon)) continue;

    featureCount += 1;
    if (item.lat >= 57 && item.lat <= 72 && item.lon >= 4 && item.lon <= 32) norwayNamedCount += 1;

    const tileId = tileIdFor(item.lat, item.lon);
    const tile = tiles.get(tileId) ?? [];
    tile.push({
      id: String(item.id),
      kind: item.kind,
      name: String(item.name),
      lat: Number(item.lat),
      lon: Number(item.lon),
      elevationM: Number.isFinite(item.elevationM) ? Number(item.elevationM) : null,
    });
    tiles.set(tileId, tile);
  }

  await fs.rm(path.join(root, outDir), { recursive: true, force: true });
  await fs.mkdir(path.join(root, outDir, "tiles"), { recursive: true });

  for (const [tileId, entries] of tiles.entries()) {
    await fs.writeFile(
      path.join(root, outDir, "tiles", `${encodeURIComponent(tileId)}.json`),
      JSON.stringify({ tileId, version: generatedVersion, entries }),
      "utf8",
    );
  }

  const benchmarkPass = norwayNamedCount >= minNorway;
  const manifest = {
    version: generatedVersion,
    generatedAt: new Date().toISOString(),
    tileDeg,
    tileUrlTemplate: "/peak-tiles/v1/tiles/{tileId}.json",
    ttlSeconds: 60 * 60 * 24 * 30,
    source: {
      provider: "osm",
      includeNatural: ["peak", "volcano"],
      namedOnly: true,
    },
    benchmark: {
      norwayNamedCount,
      minimumRequired: minNorway,
      pass: benchmarkPass,
    },
    stats: {
      featureCount,
      tileCount: tiles.size,
    },
  };

  await fs.writeFile(path.join(root, outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  await fs.rm(ndjsonPath, { force: true });

  console.log(`[peaks:osm] features=${featureCount} tiles=${tiles.size}`);
  console.log(`[peaks:osm] Norway benchmark=${norwayNamedCount} required=${minNorway} pass=${benchmarkPass}`);

  if (!benchmarkPass) {
    throw new Error(`Norway benchmark failed: ${norwayNamedCount} < ${minNorway}`);
  }
};

main().catch((error) => {
  console.error("[peaks:osm] failed", error);
  process.exitCode = 1;
});
