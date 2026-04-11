#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

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

const args = process.argv.slice(2);
const outPath = args[0] || path.join(os.tmpdir(), `overpass-peaks-${Date.now()}.ndjson`);

const getArg = (name, fallback) => {
  const idx = args.indexOf(name);
  if (idx < 0) return fallback;
  const value = args[idx + 1];
  return value == null ? fallback : value;
};

const sliceDeg = Math.max(5, Math.min(120, Number(getArg("--slice-deg", "30"))));
const maxAttempts = Math.max(1, Math.min(20, Number(getArg("--attempts", "8"))));
const timeoutMs = Math.max(30_000, Number(getArg("--timeout-ms", "300000")));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const buildQuery = (south, west, north, east) =>
  `[out:json][timeout:300];(node["natural"="peak"]["name"](${south},${west},${north},${east});node["natural"="volcano"]["name"](${south},${west},${north},${east}););out body;`;

const toSliceLabel = (bandLabel, west, east) => `${bandLabel}|${west}:${east}`;

const buildSlices = (deg) => {
  const slices = [];
  for (let west = -180; west < 180; west += deg) {
    const east = Math.min(180, west + deg);
    slices.push({ west, east });
  }
  return slices;
};

const fetchSlice = async ({ south, north, west, east, bandLabel, sliceLabel }) => {
  const query = buildQuery(south, west, north, east);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    for (const url of OVERPASS_ENDPOINTS) {
      try {
        const host = new URL(url).hostname;
        console.log(`[overpass:sliced] ${sliceLabel} attempt ${attempt + 1}/${maxAttempts} via ${host}...`);
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (response.status === 429 || response.status === 503 || response.status === 504) {
          console.log(`[overpass:sliced] ${sliceLabel}: ${response.status} from ${host}`);
          await sleep(10_000);
          continue;
        }

        if (!response.ok) {
          console.log(`[overpass:sliced] ${sliceLabel}: ${response.status} from ${host}`);
          continue;
        }

        const data = await response.json();
        if (!Array.isArray(data.elements)) {
          console.log(`[overpass:sliced] ${sliceLabel}: invalid response from ${host}`);
          continue;
        }

        console.log(`[overpass:sliced] ${sliceLabel}: ${data.elements.length} elements`);
        return data.elements;
      } catch (error) {
        console.log(`[overpass:sliced] ${sliceLabel}: error from ${new URL(url).hostname}: ${error.message}`);
      }
    }

    if (attempt < maxAttempts - 1) {
      const waitSec = Math.min(900, 45 * (attempt + 1));
      console.log(`[overpass:sliced] ${sliceLabel}: waiting ${waitSec}s before retry...`);
      await sleep(waitSec * 1000);
    }
  }

  throw new Error(`Failed to fetch ${bandLabel} slice ${west}:${east} after all retries`);
};

const parseExistingState = (targetPath) => {
  const completedBands = new Set();
  const completedSlices = new Set();
  const seenIds = new Set();

  if (!fs.existsSync(targetPath)) {
    return { completedBands, completedSlices, seenIds };
  }

  const content = fs.readFileSync(targetPath, "utf8");
  for (const line of content.split("\n")) {
    if (!line) continue;

    const bandMatch = line.match(/^# BAND:(\S+)$/);
    if (bandMatch) {
      completedBands.add(bandMatch[1]);
      continue;
    }

    const sliceMatch = line.match(/^# SLICE:(\S+)$/);
    if (sliceMatch) {
      completedSlices.add(sliceMatch[1]);
      continue;
    }

    if (line.startsWith("#")) continue;

    try {
      const item = JSON.parse(line);
      if (item && typeof item.id === "string" && item.id) {
        seenIds.add(item.id);
      }
    } catch {
      // Keep compatibility with partially written files.
    }
  }

  return { completedBands, completedSlices, seenIds };
};

const main = async () => {
  const slices = buildSlices(sliceDeg);
  console.log("[overpass:sliced] Downloading named peaks/volcanoes globally in latitude bands + longitude slices...");
  console.log(`[overpass:sliced] Output file: ${outPath}`);
  console.log(`[overpass:sliced] Bands: ${BANDS.length}; slices per band: ${slices.length}; sliceDeg=${sliceDeg}`);

  const { completedBands, completedSlices, seenIds } = parseExistingState(outPath);
  if (completedBands.size > 0) {
    console.log(`[overpass:sliced] Resuming — completed bands: ${[...completedBands].join(", ")}`);
  }
  if (completedSlices.size > 0) {
    console.log(`[overpass:sliced] Resuming — completed slices: ${completedSlices.size}`);
  }

  const out = fs.createWriteStream(outPath, {
    flags: fs.existsSync(outPath) ? "a" : "w",
    encoding: "utf8",
  });

  let totalWritten = 0;
  let totalDuplicateSkipped = 0;

  for (let bandIndex = 0; bandIndex < BANDS.length; bandIndex += 1) {
    const band = BANDS[bandIndex];
    console.log(`[overpass:sliced] Band ${bandIndex + 1}/${BANDS.length}: ${band.label} (${band.s}..${band.n})`);

    if (completedBands.has(band.label)) {
      console.log(`[overpass:sliced] Skipping ${band.label} (already complete)`);
      continue;
    }

    let bandWritten = 0;

    for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex += 1) {
      const slice = slices[sliceIndex];
      const sliceLabel = toSliceLabel(band.label, slice.west, slice.east);

      if (completedSlices.has(sliceLabel)) {
        console.log(`[overpass:sliced]   Slice ${sliceIndex + 1}/${slices.length} ${slice.west}:${slice.east} already complete`);
        continue;
      }

      console.log(`[overpass:sliced]   Slice ${sliceIndex + 1}/${slices.length}: ${slice.west}:${slice.east}`);
      const elements = await fetchSlice({
        south: band.s,
        north: band.n,
        west: slice.west,
        east: slice.east,
        bandLabel: band.label,
        sliceLabel,
      });

      let writtenThisSlice = 0;
      let duplicateThisSlice = 0;

      for (const el of elements) {
        if (el.type !== "node" || !el.tags?.name) continue;
        if (!Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;

        const id = `node:${el.id}`;
        if (seenIds.has(id)) {
          duplicateThisSlice += 1;
          totalDuplicateSkipped += 1;
          continue;
        }

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
            id,
            kind,
            name: String(el.tags.name).trim(),
            lat: el.lat,
            lon: el.lon,
            elevationM,
          }) + "\n",
        );

        seenIds.add(id);
        writtenThisSlice += 1;
        bandWritten += 1;
        totalWritten += 1;
      }

      out.write(`# SLICE:${sliceLabel}\n`);
      completedSlices.add(sliceLabel);
      console.log(
        `[overpass:sliced]   Slice done ${slice.west}:${slice.east} wrote=${writtenThisSlice} duplicateSkipped=${duplicateThisSlice} bandTotal=${bandWritten} overallWritten=${totalWritten}`,
      );

      await sleep(3_000);
    }

    out.write(`# BAND:${band.label}\n`);
    completedBands.add(band.label);
    console.log(`[overpass:sliced] Band complete ${band.label}: wrote ${bandWritten} (overall ${totalWritten})`);

    await sleep(5_000);
  }

  await new Promise((resolve) => out.end(resolve));
  console.log(`[overpass:sliced] Finished. wrote=${totalWritten} duplicateSkipped=${totalDuplicateSkipped} output=${outPath}`);
};

main().catch((error) => {
  console.error("[overpass:sliced] Failed:", error);
  process.exitCode = 1;
});
