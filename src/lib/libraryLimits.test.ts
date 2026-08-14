import { describe, expect, it } from "vitest";
import {
  LIBRARY_JSON_MAX_DEPTH,
  LIBRARY_SIMULATION_MAX_BYTES,
  LIBRARY_SITE_MAX_BYTES,
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
    systems: [],
    networks: [],
  },
});

describe("Library ingestion limits", () => {
  it("accepts the current Site and Simulation shapes", () => {
    expect(validateLibraryPayload({ siteLibrary: [validSite()], simulationPresets: [validSimulation()] })).toEqual({
      siteLibrary: [validSite()],
      simulationPresets: [validSimulation()],
    });
  });

  it("rejects malformed known fields without rejecting compatible extension fields", () => {
    expect(() => validateLibraryPayload({
      siteLibrary: [{ ...validSite(), position: { lat: 91, lon: 10 }, futureField: { supported: true } }],
      simulationPresets: [],
    })).toThrow("Site position must contain valid latitude and longitude");
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
