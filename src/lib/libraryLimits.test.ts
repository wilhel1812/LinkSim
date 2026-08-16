import { describe, expect, it } from "vitest";
import {
  LIBRARY_JSON_MAX_DEPTH,
  LIBRARY_SIMULATION_MAX_BYTES,
  LIBRARY_SITE_MAX_BYTES,
  partitionLibraryPayload,
  SIMULATION_MAX_PATHS,
  SIMULATION_MAX_SITES,
  validateLibraryPayload,
} from "./libraryLimits";

const validSite = (id = "site-1") => ({
  id,
  name: "Hilltop",
  visibility: "private",
  sharedWith: [],
  position: { lat: 59.9, lon: 10.7 },
  groundElevationM: 120,
  antennaHeightM: 12,
  txPowerDbm: 22,
  txGainDbi: 5,
  rxGainDbi: 5,
  cableLossDb: 1,
  createdAt: "2026-08-14T00:00:00.000Z",
});

const validSimulation = () => ({
  id: "sim-1",
  name: "Relay plan",
  visibility: "private",
  sharedWith: [],
  updatedAt: "2026-08-14T00:00:00.000Z",
  snapshot: {
    sites: [] as unknown[],
    links: [] as unknown[],
    systems: [] as unknown[],
    networks: [] as unknown[],
  },
});

describe("Library ingestion limits", () => {
  it("accepts the current Site and Simulation shapes", () => {
    expect(validateLibraryPayload({ siteLibrary: [validSite()], simulationPresets: [validSimulation()] })).toEqual({
      siteLibrary: [validSite()],
      simulationPresets: [validSimulation()],
    });
  });

  it("preserves the existing non-empty Library name contract", () => {
    const longName = "L".repeat(160);
    expect(() => validateLibraryPayload({
      siteLibrary: [
        { ...validSite("site-short"), name: "X" },
        { ...validSite("site-long"), name: longName },
      ],
      simulationPresets: [
        { ...validSimulation(), id: "sim-short", name: "X" },
        { ...validSimulation(), id: "sim-long", name: longName },
      ],
    })).not.toThrow();
  });

  it("accepts legacy Simulation snapshots without Radio Systems or Networks", () => {
    const withoutSystems = validSimulation() as { id: string; snapshot: Record<string, unknown> };
    withoutSystems.id = "sim-without-systems";
    delete withoutSystems.snapshot.systems;
    const withoutNetworks = validSimulation() as { id: string; snapshot: Record<string, unknown> };
    withoutNetworks.id = "sim-without-networks";
    delete withoutNetworks.snapshot.networks;

    expect(() => validateLibraryPayload({
      siteLibrary: [],
      simulationPresets: [withoutSystems, withoutNetworks],
    })).not.toThrow();
  });

  it("rejects malformed known fields without rejecting compatible extension fields", () => {
    expect(() => validateLibraryPayload({
      siteLibrary: [{ ...validSite(), position: { lat: 91, lon: 10 }, futureField: { supported: true } }],
      simulationPresets: [],
    })).toThrow("Site position must contain valid latitude and longitude");
  });

  it("rejects missing required Site and malformed Radio System or Network fields", () => {
    const missingSiteNumber = validSite() as Record<string, unknown>;
    delete missingSiteNumber.txPowerDbm;
    expect(() => validateLibraryPayload({ siteLibrary: [missingSiteNumber], simulationPresets: [] })).toThrow(
      "Site txPowerDbm must be a finite number",
    );

    const malformedSystem = validSimulation();
    malformedSystem.snapshot.systems = [null];
    expect(() => validateLibraryPayload({ siteLibrary: [], simulationPresets: [malformedSystem] })).toThrow(
      "Radio System must be an object",
    );

    const malformedNetwork = validSimulation();
    malformedNetwork.snapshot.networks = [{
      id: "network-1",
      name: "Network",
      frequencyMHz: 868,
      bandwidthKhz: 125,
      spreadFactor: 8,
      codingRate: 5,
    }];
    expect(() => validateLibraryPayload({ siteLibrary: [], simulationPresets: [malformedNetwork] })).toThrow(
      "Network memberships must be an array",
    );
  });

  it("rejects missing or malformed render-critical Simulation timestamps", () => {
    const missingUpdatedAt = validSimulation() as Record<string, unknown>;
    delete missingUpdatedAt.updatedAt;
    expect(() => validateLibraryPayload({ siteLibrary: [], simulationPresets: [missingUpdatedAt] })).toThrow(
      "Simulation updatedAt must be a valid date string",
    );

    expect(() => validateLibraryPayload({
      siteLibrary: [],
      simulationPresets: [{ ...validSimulation(), updatedAt: { unsafe: true } }],
    })).toThrow("Simulation updatedAt must be a valid date string");

    expect(() => validateLibraryPayload({
      siteLibrary: [{ ...validSite(), createdAt: "not-a-date" }],
      simulationPresets: [],
    })).toThrow("Site createdAt must be a valid date string");
  });

  it("rejects unsupported persisted enums before normalization", () => {
    expect(() => validateLibraryPayload({
      siteLibrary: [{ ...validSite(), antennaMode: "phased-array" }],
      simulationPresets: [],
    })).toThrow("Site antenna mode is not supported");

    expect(() => validateLibraryPayload({
      siteLibrary: [],
      simulationPresets: [{
        ...validSimulation(),
        snapshot: { ...validSimulation().snapshot, terrainDataset: "legacy-dem" },
      }],
    })).toThrow("Simulation terrain dataset is not supported");
  });

  it("partitions valid and malformed records without discarding the valid records", () => {
    const invalidSite = { ...validSite("bad-site"), position: { lat: 91, lon: 10 } };
    const invalidSimulation = validSimulation();
    invalidSimulation.id = "bad-sim";
    (invalidSimulation.snapshot as Record<string, unknown>).propagationEnvironment = {
      radioClimate: "Moon",
      polarization: "Vertical",
      clutterHeightM: 1,
      groundDielectric: 15,
      groundConductivity: 0.005,
      atmosphericBendingNUnits: 301,
    };
    const result = partitionLibraryPayload({
      siteLibrary: [validSite(), invalidSite, null],
      simulationPresets: [validSimulation(), invalidSimulation],
    });
    expect(result.siteLibrary).toHaveLength(1);
    expect(result.simulationPresets).toHaveLength(1);
    expect(result.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "site", id: "bad-site" }),
      expect.objectContaining({ kind: "site", id: null }),
      expect.objectContaining({ kind: "simulation", id: "bad-sim" }),
    ]));
  });

  it("rejects every record involved in a duplicate ID", () => {
    const result = partitionLibraryPayload({
      siteLibrary: [validSite(), { ...validSite(), name: "Other" }],
      simulationPresets: [],
    });
    expect(result.siteLibrary).toEqual([]);
    expect(result.rejected).toHaveLength(2);
  });

  it("quarantines malformed collection shapes", () => {
    const result = partitionLibraryPayload({ siteLibrary: { unsafe: true }, simulationPresets: null });
    expect(result.siteLibrary).toEqual([]);
    expect(result.simulationPresets).toEqual([]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ kind: "site", reason: "Site Library collection must be an array." }),
      expect.objectContaining({ kind: "simulation", reason: "Simulation Library collection must be an array." }),
    ]);
  });

  it("rejects Simulation collection counts above their approved boundaries", () => {
    const simulation = validSimulation();
    simulation.snapshot.sites = Array.from({ length: SIMULATION_MAX_SITES + 1 }, (_, index) => validSite(`site-${index}`));
    expect(() => validateLibraryPayload({ siteLibrary: [], simulationPresets: [simulation] })).toThrow(
      `Simulation may contain at most ${SIMULATION_MAX_SITES} Sites`,
    );

    simulation.snapshot.sites = [];
    simulation.snapshot.links = Array.from({ length: SIMULATION_MAX_PATHS + 1 }, (_, index) => ({
      id: `path-${index}`,
      fromSiteId: "site-a",
      toSiteId: "site-b",
      frequencyMHz: 868,
    }));
    expect(() => validateLibraryPayload({ siteLibrary: [], simulationPresets: [simulation] })).toThrow(
      `Simulation may contain at most ${SIMULATION_MAX_PATHS} Paths`,
    );
  });

  it("accepts records exactly at their byte ceilings and rejects one byte more", () => {
    const encoder = new TextEncoder();
    const exactSite = { ...validSite(), extension: "" };
    exactSite.extension = "x".repeat(LIBRARY_SITE_MAX_BYTES - encoder.encode(JSON.stringify(exactSite)).byteLength);
    expect(() => validateLibraryPayload({ siteLibrary: [exactSite], simulationPresets: [] })).not.toThrow();
    exactSite.extension += "x";
    expect(() => validateLibraryPayload({ siteLibrary: [exactSite], simulationPresets: [] })).toThrow("Site record exceeds");

    const exactSimulation = { ...validSimulation(), extension: "" };
    exactSimulation.extension = "x".repeat(
      LIBRARY_SIMULATION_MAX_BYTES - encoder.encode(JSON.stringify(exactSimulation)).byteLength,
    );
    expect(() => validateLibraryPayload({ siteLibrary: [], simulationPresets: [exactSimulation] })).not.toThrow();
    exactSimulation.extension += "x";
    expect(() => validateLibraryPayload({ siteLibrary: [], simulationPresets: [exactSimulation] })).toThrow(
      "Simulation record exceeds",
    );
  });

  it("exports the approved JSON depth contract", () => {
    expect(LIBRARY_JSON_MAX_DEPTH).toBe(20);
  });
});
