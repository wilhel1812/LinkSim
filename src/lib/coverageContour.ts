import type { CoverageSampleLite, TerrainBounds } from "./overlayRaster";

export type ContourLineFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { targetDbm: number };
    geometry: {
      type: "LineString";
      coordinates: Array<[number, number]>;
    };
  }>;
};

type GridCell = {
  lat0: number;
  lat1: number;
  lon0: number;
  lon1: number;
  v00: number;
  v10: number;
  v11: number;
  v01: number;
};

export type DenseCoverageContourInput = {
  height: number;
  latByRow: Float64Array;
  lonByCol: Float64Array;
  pointMask?: ((lat: number, lon: number) => boolean) | null;
  targetDbm: number;
  valuesDbm: Float32Array;
  width: number;
};

export type ContourWorkRunner = (
  total: number,
  runner: (index: number) => void,
  progressStartPercent: number,
  progressEndPercent: number,
) => Promise<void>;

const emptyContour = (): ContourLineFeatureCollection => ({ type: "FeatureCollection", features: [] });

const pointKey = (point: [number, number]): string => `${point[0].toFixed(8)},${point[1].toFixed(8)}`;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const edgeCrossing = (
  a: { lat: number; lon: number; value: number },
  b: { lat: number; lon: number; value: number },
  targetDbm: number,
): [number, number] | null => {
  const da = a.value - targetDbm;
  const db = b.value - targetDbm;
  if (da === 0 && db === 0) return null;
  if (da * db > 0) return null;
  const denominator = b.value - a.value;
  const t = denominator === 0 ? 0.5 : (targetDbm - a.value) / denominator;
  return [lerp(a.lon, b.lon, t), lerp(a.lat, b.lat, t)];
};

const cellSegments = (cell: GridCell, targetDbm: number): Array<[[number, number], [number, number]]> => {
  const bottomLeft = { lat: cell.lat0, lon: cell.lon0, value: cell.v00 };
  const bottomRight = { lat: cell.lat0, lon: cell.lon1, value: cell.v10 };
  const topRight = { lat: cell.lat1, lon: cell.lon1, value: cell.v11 };
  const topLeft = { lat: cell.lat1, lon: cell.lon0, value: cell.v01 };
  const crossings = [
    edgeCrossing(bottomLeft, bottomRight, targetDbm),
    edgeCrossing(bottomRight, topRight, targetDbm),
    edgeCrossing(topRight, topLeft, targetDbm),
    edgeCrossing(topLeft, bottomLeft, targetDbm),
  ]
    .filter((point): point is [number, number] => point !== null)
    .filter((point, index, points) => points.findIndex((candidate) => pointKey(candidate) === pointKey(point)) === index);

  if (crossings.length < 2) return [];
  if (crossings.length === 2) return [[crossings[0], crossings[1]]];
  if (crossings.length === 3) {
    return [
      [crossings[0], crossings[1]],
      [crossings[1], crossings[2]],
    ];
  }
  return [
    [crossings[0], crossings[1]],
    [crossings[2], crossings[3]],
  ];
};

const stitchSegments = (segments: Array<[[number, number], [number, number]]>): Array<Array<[number, number]>> => {
  const unused = [...segments];
  const lines: Array<Array<[number, number]>> = [];

  while (unused.length) {
    const current = unused.pop()!;
    const line = [current[0], current[1]];
    let extended = true;

    while (extended) {
      extended = false;
      const startKey = pointKey(line[0]);
      const endKey = pointKey(line[line.length - 1]);
      for (let i = unused.length - 1; i >= 0; i -= 1) {
        const [a, b] = unused[i];
        const aKey = pointKey(a);
        const bKey = pointKey(b);
        if (bKey === startKey) line.unshift(a);
        else if (aKey === startKey) line.unshift(b);
        else if (aKey === endKey) line.push(b);
        else if (bKey === endKey) line.push(a);
        else continue;
        unused.splice(i, 1);
        extended = true;
        break;
      }
    }

    lines.push(line);
  }

  return lines;
};

const featuresFromSegments = (
  segments: Array<[[number, number], [number, number]]>,
  targetDbm: number,
): ContourLineFeatureCollection => ({
  type: "FeatureCollection",
  features: stitchSegments(segments).map((line) => ({
    type: "Feature",
    properties: { targetDbm },
    geometry: { type: "LineString", coordinates: smoothLine(line) },
  })),
});

const smoothLine = (line: Array<[number, number]>): Array<[number, number]> => {
  if (line.length < 3) return line;
  let smoothed = line;
  for (let pass = 0; pass < 2; pass += 1) {
    const next: Array<[number, number]> = [smoothed[0]];
    for (let i = 0; i < smoothed.length - 1; i += 1) {
      const [x0, y0] = smoothed[i];
      const [x1, y1] = smoothed[i + 1];
      next.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25]);
      next.push([x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    next.push(smoothed[smoothed.length - 1]);
    smoothed = next;
  }
  return smoothed;
};

export const buildCoverageTargetContourFeatures = (
  samples: CoverageSampleLite[],
  targetDbm: number,
  bounds?: TerrainBounds | null,
  pointMask?: ((lat: number, lon: number) => boolean) | null,
): ContourLineFeatureCollection => {
  if (samples.length < 4 || !Number.isFinite(targetDbm)) return emptyContour();

  const lats = Array.from(new Set(samples.map((sample) => sample.lat))).sort((a, b) => a - b);
  const lons = Array.from(new Set(samples.map((sample) => sample.lon))).sort((a, b) => a - b);
  if (lats.length < 2 || lons.length < 2 || lats.length * lons.length !== samples.length) return emptyContour();

  const latIndex = new Map<number, number>();
  const lonIndex = new Map<number, number>();
  lats.forEach((lat, index) => latIndex.set(lat, index));
  lons.forEach((lon, index) => lonIndex.set(lon, index));

  const values = new Float64Array(lats.length * lons.length);
  const seen = new Uint8Array(lats.length * lons.length);
  for (const sample of samples) {
    const yi = latIndex.get(sample.lat);
    const xi = lonIndex.get(sample.lon);
    if (yi === undefined || xi === undefined) return emptyContour();
    const idx = yi * lons.length + xi;
    values[idx] = sample.valueDbm;
    seen[idx] = 1;
  }
  for (const mark of seen) {
    if (mark !== 1) return emptyContour();
  }

  const segments: Array<[[number, number], [number, number]]> = [];
  for (let y = 0; y < lats.length - 1; y += 1) {
    for (let x = 0; x < lons.length - 1; x += 1) {
      const lat0 = lats[y];
      const lat1 = lats[y + 1];
      const lon0 = lons[x];
      const lon1 = lons[x + 1];
      if (
        bounds &&
        (lat1 < bounds.minLat || lat0 > bounds.maxLat || lon1 < bounds.minLon || lon0 > bounds.maxLon)
      ) {
        continue;
      }
      const idx = y * lons.length + x;
      const cellLineSegments = cellSegments(
        {
          lat0,
          lat1,
          lon0,
          lon1,
          v00: values[idx],
          v10: values[idx + 1],
          v11: values[idx + lons.length + 1],
          v01: values[idx + lons.length],
        },
        targetDbm,
      );
      for (const segment of cellLineSegments) {
        const midLon = (segment[0][0] + segment[1][0]) / 2;
        const midLat = (segment[0][1] + segment[1][1]) / 2;
        if (
          pointMask &&
          (!pointMask(segment[0][1], segment[0][0]) ||
            !pointMask(midLat, midLon) ||
            !pointMask(segment[1][1], segment[1][0]))
        ) {
          continue;
        }
        segments.push(segment);
      }
    }
  }

  return featuresFromSegments(segments, targetDbm);
};

const isValidDenseContourInput = ({
  height,
  latByRow,
  lonByCol,
  targetDbm,
  valuesDbm,
  width,
}: DenseCoverageContourInput): boolean =>
  width >= 2 &&
  height >= 2 &&
  latByRow.length === height &&
  lonByCol.length === width &&
  valuesDbm.length === width * height &&
  Number.isFinite(targetDbm);

const visitDenseCellSegments = (
  input: DenseCoverageContourInput,
  cellIndex: number,
  visit: (segment: [[number, number], [number, number]]) => void,
): void => {
  const { height, latByRow, lonByCol, pointMask, targetDbm, valuesDbm, width } = input;
  const cellWidth = width - 1;
  const y = Math.floor(cellIndex / cellWidth);
  if (y >= height - 1) return;
  const x = cellIndex - y * cellWidth;
  const topLeftIndex = y * width + x;
  const topRightIndex = topLeftIndex + 1;
  const bottomLeftIndex = topLeftIndex + width;
  const bottomRightIndex = bottomLeftIndex + 1;
  const v00 = valuesDbm[bottomLeftIndex];
  const v10 = valuesDbm[bottomRightIndex];
  const v11 = valuesDbm[topRightIndex];
  const v01 = valuesDbm[topLeftIndex];
  if (![v00, v10, v11, v01].every(Number.isFinite)) return;
  if (targetDbm < Math.min(v00, v10, v11, v01) || targetDbm > Math.max(v00, v10, v11, v01)) return;

  const segments = cellSegments(
    {
      lat0: latByRow[y + 1],
      lat1: latByRow[y],
      lon0: lonByCol[x],
      lon1: lonByCol[x + 1],
      v00,
      v10,
      v11,
      v01,
    },
    targetDbm,
  );
  for (const segment of segments) {
    const midLon = (segment[0][0] + segment[1][0]) / 2;
    const midLat = (segment[0][1] + segment[1][1]) / 2;
    if (
      pointMask &&
      (!pointMask(segment[0][1], segment[0][0]) ||
        !pointMask(midLat, midLon) ||
        !pointMask(segment[1][1], segment[1][0]))
    ) {
      continue;
    }
    visit(segment);
  }
};

export const buildDenseCoverageTargetContourFeatures = (
  input: DenseCoverageContourInput,
): ContourLineFeatureCollection => {
  if (!isValidDenseContourInput(input)) return emptyContour();
  const segments: Array<[[number, number], [number, number]]> = [];
  const totalCells = (input.width - 1) * (input.height - 1);
  for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
    visitDenseCellSegments(input, cellIndex, (segment) => segments.push(segment));
  }
  return featuresFromSegments(segments, input.targetDbm);
};

const stitchSegmentsCooperatively = async (
  segments: Array<[[number, number], [number, number]]>,
  runWork: ContourWorkRunner,
): Promise<Array<Array<[number, number]>>> => {
  if (segments.length === 0) return [];

  const connectedByPoint = new Map<string, number[]>();
  await runWork(segments.length, (index) => {
    for (const point of segments[index]) {
      const key = pointKey(point);
      const connected = connectedByPoint.get(key);
      if (connected) connected.push(index);
      else connectedByPoint.set(key, [index]);
    }
  }, 55, 65);

  const candidates: Array<{ point: [number, number]; segmentIndex: number }> = [];
  await runWork(segments.length, (index) => {
    const [a, b] = segments[index];
    if (connectedByPoint.get(pointKey(a))?.length === 1) candidates.push({ point: a, segmentIndex: index });
    if (connectedByPoint.get(pointKey(b))?.length === 1) candidates.push({ point: b, segmentIndex: index });
  }, 65, 70);
  await runWork(segments.length, (index) => {
    candidates.push({ point: segments[index][0], segmentIndex: index });
  }, 70, 72);

  const used = new Uint8Array(segments.length);
  const lines: Array<Array<[number, number]>> = [];
  let candidateIndex = 0;
  let activeLine: Array<[number, number]> | null = null;
  let activeEndpoint: [number, number] | null = null;

  await runWork(segments.length * 4, () => {
    if (activeLine && activeEndpoint) {
      const connected = connectedByPoint.get(pointKey(activeEndpoint));
      const nextSegmentIndex = connected?.find((index) => used[index] === 0);
      if (nextSegmentIndex !== undefined) {
        const [a, b] = segments[nextSegmentIndex];
        const nextPoint = pointKey(a) === pointKey(activeEndpoint) ? b : a;
        used[nextSegmentIndex] = 1;
        activeLine.push(nextPoint);
        activeEndpoint = nextPoint;
        return;
      }
      lines.push(activeLine);
      activeLine = null;
      activeEndpoint = null;
      return;
    }

    const candidate = candidates[candidateIndex];
    candidateIndex += 1;
    if (!candidate || used[candidate.segmentIndex]) return;
    const [a, b] = segments[candidate.segmentIndex];
    const startsAtA = pointKey(a) === pointKey(candidate.point);
    activeLine = startsAtA ? [a, b] : [b, a];
    activeEndpoint = startsAtA ? b : a;
    used[candidate.segmentIndex] = 1;
  }, 72, 84);

  if (activeLine) lines.push(activeLine);
  return lines;
};

const smoothLinesOnceCooperatively = async (
  lines: Array<Array<[number, number]>>,
  runWork: ContourWorkRunner,
  progressStartPercent: number,
  progressEndPercent: number,
): Promise<Array<Array<[number, number]>>> => {
  const nextLines: Array<Array<[number, number]>> = new Array(lines.length);
  const eligibleLineIndexes: number[] = [];
  let totalEdges = 0;
  const setupEndPercent = progressStartPercent + (progressEndPercent - progressStartPercent) * 0.1;
  await runWork(lines.length, (index) => {
    const line = lines[index];
    if (line.length < 3) {
      nextLines[index] = line;
      return;
    }
    nextLines[index] = [line[0]];
    eligibleLineIndexes.push(index);
    totalEdges += line.length - 1;
  }, progressStartPercent, setupEndPercent);

  let eligibleIndex = 0;
  let edgeIndex = 0;
  await runWork(totalEdges, () => {
    const lineIndex = eligibleLineIndexes[eligibleIndex];
    const line = lines[lineIndex];
    const [x0, y0] = line[edgeIndex];
    const [x1, y1] = line[edgeIndex + 1];
    nextLines[lineIndex].push(
      [x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25],
      [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75],
    );
    edgeIndex += 1;
    if (edgeIndex === line.length - 1) {
      nextLines[lineIndex].push(line[line.length - 1]);
      eligibleIndex += 1;
      edgeIndex = 0;
    }
  }, setupEndPercent, progressEndPercent);
  return nextLines;
};

export const buildDenseCoverageTargetContourFeaturesAsync = async (
  input: DenseCoverageContourInput,
  runWork: ContourWorkRunner,
): Promise<ContourLineFeatureCollection> => {
  if (!isValidDenseContourInput(input)) return emptyContour();

  const segments: Array<[[number, number], [number, number]]> = [];
  const totalCells = (input.width - 1) * (input.height - 1);
  await runWork(totalCells, (cellIndex) => {
    visitDenseCellSegments(input, cellIndex, (segment) => segments.push(segment));
  }, 0, 55);

  const lines = await stitchSegmentsCooperatively(segments, runWork);
  const smoothedOnce = await smoothLinesOnceCooperatively(lines, runWork, 84, 91);
  const smoothedTwice = await smoothLinesOnceCooperatively(smoothedOnce, runWork, 91, 98);
  const features: ContourLineFeatureCollection["features"] = new Array(smoothedTwice.length);
  await runWork(Math.max(1, smoothedTwice.length), (index) => {
    if (index >= smoothedTwice.length) return;
    features[index] = {
      type: "Feature",
      properties: { targetDbm: input.targetDbm },
      geometry: { type: "LineString", coordinates: smoothedTwice[index] },
    };
  }, 98, 100);
  return { type: "FeatureCollection", features };
};
