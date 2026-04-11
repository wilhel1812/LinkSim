#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const outPath = process.argv[2] || path.join(os.tmpdir(), `overpass-peaks-${Date.now()}.ndjson`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Split the world into latitude bands to keep each query manageable.
const BANDS = [
  { s: -90, n: -30, label: "S90-S30" },
  { s: -30, n: 0, label: "S30-0" },
  { s: 0, n: 20, label: "0-N20" },
  { s: 20, n: 35, label: "N20-N35" },
  { s: 35, n: 45, label: "N35-N45" },
  { s: 45, n: 55, label: "N45-N55" },
  { s: 55, n: 70, label: "N55-N70" },
  { s: 70, n: 90, label: "N70-N90" },
];

const buildQuery = (south, north) =>
  `[out:json][timeout:300];(node["natural"="peak"]["name"](${south},-180,${north},180);node["natural"="volcano"]["name"](${south},-180,${north},180););out body;`;

const fetchBand = async (south, north, label) => {
  const query = buildQuery(south, north);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    for (const url of OVERPASS_ENDPOINTS) {
      try {
        const host = new URL(url).hostname;
        console.log(`[overpass] ${label} attempt ${attempt + 1}/6 via ${host}...`);
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(300_000),
        });
        if (response.status === 429 || response.status === 504 || response.status === 503) {
          console.log(`[overpass] ${label}: ${response.status} from ${host}`);
          // Wait a bit before trying next endpoint too
          await sleep(10_000);
          continue;
        }
        if (!response.ok) {
          console.log(`[overpass] ${label}: ${response.status} from ${host}`);
          continue;
        }
        const data = await response.json();
        if (!Array.isArray(data.elements)) {
          console.log(`[overpass] ${label}: invalid response from ${host}`);
          continue;
        }
        console.log(`[overpass] ${label}: ${data.elements.length} elements`);
        return data.elements;
      } catch (error) {
        console.log(`[overpass] ${label}: error from ${new URL(url).hostname}: ${error.message}`);
      }
    }
    if (attempt < 5) {
      const waitSec = 60 * (attempt + 1);
      console.log(`[overpass] ${label}: waiting ${waitSec}s before retry...`);
      await sleep(waitSec * 1000);
    }
  }
  throw new Error(`Failed to fetch band ${label} after all retries`);
};

const main = async () => {
  console.log("[overpass] Downloading named peaks/volcanoes globally in latitude bands...");
  console.log(`[overpass] Output file: ${outPath}`);
  console.log(`[overpass] Total latitude bands: ${BANDS.length}`);

  // Support resume: if the output file exists, count existing lines and skip
  // completed bands. Each band appends a marker line "# BAND:<label>" before its data.
  const completedBands = new Set();
  if (fs.existsSync(outPath)) {
    const existing = fs.readFileSync(outPath, "utf8");
    for (const line of existing.split("\n")) {
      const match = line.match(/^# BAND:(\S+)$/);
      if (match) completedBands.add(match[1]);
    }
    if (completedBands.size > 0) {
      console.log(`[overpass] Resuming — already have bands: ${[...completedBands].join(", ")}`);
    }
  }

  const out = fs.createWriteStream(outPath, { flags: completedBands.size > 0 ? "a" : "w", encoding: "utf8" });
  let totalCount = 0;
  let completedCount = 0;

  for (let index = 0; index < BANDS.length; index += 1) {
    const band = BANDS[index];
    console.log(`[overpass] Band ${index + 1}/${BANDS.length}: ${band.label} (${band.s}..${band.n})`);
    if (completedBands.has(band.label)) {
      console.log(`[overpass] Skipping ${band.label} (already downloaded)`);
      completedCount += 1;
      console.log(`[overpass] Progress: ${completedCount}/${BANDS.length} bands complete`);
      continue;
    }
    const elements = await fetchBand(band.s, band.n, band.label);
    out.write(`# BAND:${band.label}\n`);

    let writtenForBand = 0;
    for (const el of elements) {
      if (el.type !== "node" || !el.tags?.name) continue;
      if (!Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;

      const kind = el.tags.natural === "volcano" ? "volcano" : "peak";
      let elevationM = null;
      if (el.tags.ele) {
        const filtered = String(el.tags.ele).replace(/[^\d.+-]/g, "");
        if (filtered) {
          const parsed = Number.parseFloat(filtered);
          if (Number.isFinite(parsed)) elevationM = Math.round(parsed);
        }
      }

      out.write(
        JSON.stringify({
          id: `node:${el.id}`,
          kind,
          name: String(el.tags.name).trim(),
          lat: el.lat,
          lon: el.lon,
          elevationM,
        }) + "\n",
      );
      totalCount += 1;
      writtenForBand += 1;
    }

    completedCount += 1;
    console.log(
      `[overpass] ${band.label}: wrote ${writtenForBand} features (${totalCount} total); progress ${completedCount}/${BANDS.length} bands`,
    );

    // Be polite to the API between bands
    await sleep(5_000);
  }

  await new Promise((resolve) => out.end(resolve));
  console.log(`[overpass] Total: ${totalCount} features written to ${outPath}`);
};

main().catch((error) => {
  console.error("[overpass] Failed:", error);
  process.exitCode = 1;
});
