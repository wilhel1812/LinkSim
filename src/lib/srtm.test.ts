import { zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import type { SrtmTile } from "../types/radio";
import { parseSrtmTile, parseSrtmZip, sampleSrtmElevation } from "./srtm";

const SRTM3_BYTE_LENGTH = 1201 * 1201 * 2;
const SRTM1_BYTE_LENGTH = 3601 * 3601 * 2;
const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const findSignature = (bytes: Uint8Array, signature: number, fromEnd = false): number => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fromEnd) {
    for (let offset = bytes.byteLength - 4; offset >= 0; offset -= 1) {
      if (view.getUint32(offset, true) === signature) return offset;
    }
    return -1;
  }
  for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
};

const makeTile = (params: {
  key: string;
  latStart: number;
  lonStart: number;
  values: number[];
  size?: number;
  sourceId?: string;
  sourceKind?: SrtmTile["sourceKind"];
  arcSecondSpacing?: 1 | 3;
}): SrtmTile => {
  const size = params.size ?? Math.round(Math.sqrt(params.values.length));
  return {
    key: params.key,
    latStart: params.latStart,
    lonStart: params.lonStart,
    size,
    width: size,
    height: size,
    arcSecondSpacing: params.arcSecondSpacing ?? 3,
    elevations: new Int16Array(params.values),
    sourceId: params.sourceId,
    sourceKind: params.sourceKind,
  };
};

describe("sampleSrtmElevation", () => {
  it("samples expected nearest grid cell values", () => {
    const tile = makeTile({
      key: "N59E010",
      latStart: 59,
      lonStart: 10,
      size: 3,
      values: [
        11, 12, 13,
        21, 22, 23,
        31, 32, 33,
      ],
      sourceId: "copernicus30",
    });

    expect(sampleSrtmElevation([tile], 59.95, 10.05)).toBe(11);
    expect(sampleSrtmElevation([tile], 59.5, 10.5)).toBe(22);
    expect(sampleSrtmElevation([tile], 59.05, 10.95)).toBe(33);
  });

  it("uses quality precedence when duplicate tile keys exist", () => {
    const low = makeTile({
      key: "N59E010",
      latStart: 59,
      lonStart: 10,
      size: 2,
      values: [90, 90, 90, 90],
      sourceId: "copernicus90",
      arcSecondSpacing: 3,
    });
    const high = makeTile({
      key: "N59E010",
      latStart: 59,
      lonStart: 10,
      size: 2,
      values: [30, 30, 30, 30],
      sourceId: "copernicus30",
      arcSecondSpacing: 1,
    });
    const manual = makeTile({
      key: "N59E010",
      latStart: 59,
      lonStart: 10,
      size: 2,
      values: [7, 7, 7, 7],
      sourceKind: "manual-upload",
      sourceId: "uploaded",
      arcSecondSpacing: 1,
    });

    expect(sampleSrtmElevation([low, high], 59.7, 10.7)).toBe(30);
    expect(sampleSrtmElevation([high, manual], 59.7, 10.7)).toBe(7);
  });

  it("samples correctly on tile boundary coordinates", () => {
    const southWest = makeTile({
      key: "N59E010",
      latStart: 59,
      lonStart: 10,
      size: 2,
      values: [5910, 5910, 5910, 5910],
      sourceId: "copernicus30",
    });
    const northWest = makeTile({
      key: "N60E010",
      latStart: 60,
      lonStart: 10,
      size: 2,
      values: [6010, 6010, 6010, 6010],
      sourceId: "uploaded",
      sourceKind: "manual-upload",
    });

    expect(sampleSrtmElevation([southWest, northWest], 60, 10.4)).toBe(6010);
  });

  it("returns null for nodata samples", () => {
    const tile = makeTile({
      key: "N59E010",
      latStart: 59,
      lonStart: 10,
      size: 2,
      values: [-32768, -32768, -32768, -32768],
      sourceId: "copernicus30",
    });
    expect(sampleSrtmElevation([tile], 59.4, 10.4)).toBeNull();
  });

  it("normalizes unwrapped longitudes when sampling antimeridian terrain", () => {
    const tile = makeTile({
      key: "N10W180",
      latStart: 10,
      lonStart: -180,
      size: 2,
      values: [5, 5, 5, 5],
    });

    expect(sampleSrtmElevation([tile], 10.5, 180.1)).toBe(5);
  });

  it("samples a saved +180 coordinate from an E179-only tile", () => {
    const east = makeTile({
      key: "N10E179",
      latStart: 10,
      lonStart: 179,
      size: 2,
      values: [1, 7, 1, 7],
      sourceKind: "manual-upload",
    });

    expect(sampleSrtmElevation([east], 10.5, 180)).toBe(7);
  });

  it("samples a saved -180 coordinate from a W180-only tile", () => {
    const west = makeTile({
      key: "N10W180",
      latStart: 10,
      lonStart: -180,
      size: 2,
      values: [8, 1, 8, 1],
      sourceKind: "manual-upload",
    });

    expect(sampleSrtmElevation([west], 10.5, -180)).toBe(8);
  });

  it("deterministically applies terrain precedence when both dateline tiles are present", () => {
    const east = makeTile({
      key: "N10E179",
      latStart: 10,
      lonStart: 179,
      size: 2,
      values: [1, 7, 1, 7],
      sourceId: "copernicus30",
      arcSecondSpacing: 1,
    });
    const west = makeTile({
      key: "N10W180",
      latStart: 10,
      lonStart: -180,
      size: 2,
      values: [8, 1, 8, 1],
      sourceKind: "manual-upload",
      arcSecondSpacing: 1,
    });

    expect(sampleSrtmElevation([east, west], 10.5, 180)).toBe(8);
    expect(sampleSrtmElevation([west, east], 10.5, -180)).toBe(8);
  });
});

describe("SRTM ingestion bounds", () => {
  it.each([
    ["N59E010.hgt", SRTM3_BYTE_LENGTH, 1201],
    ["N59E010.hgt", SRTM1_BYTE_LENGTH, 3601],
  ])("accepts %s with exact %i-byte size", async (name, byteLength, size) => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(byteLength));
    const file = { name, size: byteLength, arrayBuffer } as unknown as File;

    await expect(parseSrtmTile(file)).resolves.toMatchObject({ size });
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("rejects an unsupported raw HGT size before reading its body", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    const file = { name: "N59E010.hgt", size: 1, arrayBuffer } as unknown as File;

    await expect(parseSrtmTile(file)).rejects.toThrow("Unsupported SRTM tile dimensions");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("rejects an oversized ZIP before reading its body", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    const file = {
      name: "terrain.zip",
      size: 32 * 1024 * 1024 + 1,
      arrayBuffer,
    } as unknown as File;

    await expect(parseSrtmTile(file)).rejects.toThrow("32 MiB");
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("accepts an exact 32 MiB ZIP through preflight before parsing its body", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(1));
    const file = {
      name: "terrain.zip",
      size: 32 * 1024 * 1024,
      arrayBuffer,
    } as unknown as File;

    await expect(parseSrtmTile(file)).rejects.toThrow();
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("accepts exactly 16 central entries while extracting only the supported HGT", () => {
    const metadata = Object.fromEntries(
      Array.from({ length: 15 }, (_, index) => [`metadata-${index}.txt`, new Uint8Array([index])]),
    );
    const zip = zipSync({ ...metadata, "nested/N59E010.hgt": new Uint8Array(SRTM3_BYTE_LENGTH) });

    expect(parseSrtmZip("terrain.zip", toArrayBuffer(zip)).key).toBe("N59E010");
  });

  it("rejects forged supported size metadata when actual expansion exceeds the maximum", () => {
    const zip = zipSync(
      { "N59E010.hgt": new Uint8Array(SRTM1_BYTE_LENGTH + 64 * 1024) },
      { level: 9 },
    );
    const forged = zip.slice();
    const view = new DataView(forged.buffer, forged.byteOffset, forged.byteLength);
    let centralOffset = -1;
    for (let offset = forged.byteLength - 22; offset >= 0; offset -= 1) {
      if (view.getUint32(offset, true) === 0x02014b50) {
        centralOffset = offset;
        break;
      }
    }
    expect(centralOffset).toBeGreaterThanOrEqual(0);
    view.setUint32(centralOffset + 24, SRTM1_BYTE_LENGTH, true);
    const localOffset = findSignature(forged, 0x04034b50);
    expect(localOffset).toBeGreaterThanOrEqual(0);
    view.setUint32(localOffset + 22, SRTM1_BYTE_LENGTH, true);

    expect(() => parseSrtmZip("forged.zip", toArrayBuffer(forged))).toThrow("expanded data limit");
  });

  it("rejects ZIPs with more than 16 entries", () => {
    const entries = Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [`metadata-${index}.txt`, new Uint8Array([index])]),
    );
    const zip = zipSync({ ...entries, "N59E010.hgt": new Uint8Array(SRTM3_BYTE_LENGTH) });

    expect(() => parseSrtmZip("terrain.zip", toArrayBuffer(zip))).toThrow("16 entries");
  });

  it("rejects an EOCD entry count that underreports 17 local entries", () => {
    const metadata = Object.fromEntries(
      Array.from({ length: 16 }, (_, index) => [`metadata-${index}.txt`, new Uint8Array([index])]),
    );
    const forged = zipSync({ "N59E010.hgt": new Uint8Array(SRTM3_BYTE_LENGTH), ...metadata }).slice();
    const eocdOffset = findSignature(forged, 0x06054b50, true);
    expect(eocdOffset).toBeGreaterThanOrEqual(0);
    const view = new DataView(forged.buffer, forged.byteOffset, forged.byteLength);
    view.setUint16(eocdOffset + 8, 1, true);
    view.setUint16(eocdOffset + 10, 1, true);

    expect(() => parseSrtmZip("underreported.zip", toArrayBuffer(forged))).toThrow("16 entries");
  });

  it("rejects central and local HGT name mismatches", () => {
    const forged = zipSync({ "N59E010.hgt": new Uint8Array(SRTM3_BYTE_LENGTH) }).slice();
    const centralOffset = findSignature(forged, 0x02014b50);
    expect(centralOffset).toBeGreaterThanOrEqual(0);
    forged.set(new TextEncoder().encode("N60E010.hgt"), centralOffset + 46);

    expect(() => parseSrtmZip("mismatch.zip", toArrayBuffer(forged))).toThrow("central/local");
  });

  it("rejects a local original size that disagrees with valid central metadata", () => {
    const forged = zipSync({ "N59E010.hgt": new Uint8Array(SRTM3_BYTE_LENGTH) }).slice();
    const localOffset = findSignature(forged, 0x04034b50);
    expect(localOffset).toBeGreaterThanOrEqual(0);
    new DataView(forged.buffer, forged.byteOffset, forged.byteLength).setUint32(localOffset + 22, 1, true);

    expect(() => parseSrtmZip("local-size.zip", toArrayBuffer(forged))).toThrow("central/local");
  });

  it("rejects local compression that disagrees with central metadata", () => {
    const forged = zipSync({ "N59E010.hgt": new Uint8Array(SRTM3_BYTE_LENGTH) }).slice();
    const localOffset = findSignature(forged, 0x04034b50);
    expect(localOffset).toBeGreaterThanOrEqual(0);
    new DataView(forged.buffer, forged.byteOffset, forged.byteLength).setUint16(localOffset + 8, 0, true);

    expect(() => parseSrtmZip("local-compression.zip", toArrayBuffer(forged))).toThrow("central/local");
  });

  it("rejects a second local HGT omitted from central HGT metadata", () => {
    const forged = zipSync({
      "N59E010.hgt": new Uint8Array(SRTM3_BYTE_LENGTH),
      "other00.txt": new Uint8Array([1]),
    }).slice();
    const firstLocalOffset = findSignature(forged, 0x04034b50);
    const secondLocalOffset = findSignature(forged.subarray(firstLocalOffset + 4), 0x04034b50);
    expect(secondLocalOffset).toBeGreaterThanOrEqual(0);
    const absoluteSecondOffset = firstLocalOffset + 4 + secondLocalOffset;
    forged.set(new TextEncoder().encode("N60E010.hgt"), absoluteSecondOffset + 30);

    expect(() => parseSrtmZip("local-duplicate.zip", toArrayBuffer(forged))).toThrow(
      "exactly one local .hgt",
    );
  });

  it("rejects ZIPs with multiple HGT entries or unsupported declared HGT sizes", () => {
    const multiple = zipSync({
      "N59E010.hgt": new Uint8Array(SRTM3_BYTE_LENGTH),
      "N60E010.hgt": new Uint8Array(SRTM3_BYTE_LENGTH),
    });
    const unsupported = zipSync({ "N59E010.hgt": new Uint8Array([1, 2]) });

    expect(() => parseSrtmZip("multiple.zip", toArrayBuffer(multiple))).toThrow("exactly one .hgt");
    expect(() => parseSrtmZip("unsupported.zip", toArrayBuffer(unsupported))).toThrow(
      "Unsupported SRTM tile dimensions",
    );
  });
});
