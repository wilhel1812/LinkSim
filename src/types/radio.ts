export type Coordinates = {
  lat: number;
  lon: number;
};

export type Site = {
  id: string;
  name: string;
  position: Coordinates;
  groundElevationM: number;
  antennaHeightM: number;
  txPowerDbm: number;
  txGainDbi: number;
  rxGainDbi: number;
  cableLossDb: number;
  libraryEntryId?: string;
};

export type Link = {
  id: string;
  name?: string;
  fromSiteId: string;
  toSiteId: string;
  frequencyMHz: number;
  txPowerDbm?: number;
  txGainDbi?: number;
  rxGainDbi?: number;
  cableLossDb?: number;
};

export type PropagationModel = "FSPL" | "TwoRay" | "ITM";
export type CoverageMode = "BestSite" | "Polar" | "Cartesian" | "Route";
export type Polarization = "Vertical" | "Horizontal";
export type RadioClimate =
  | "Equatorial"
  | "Continental Subtropical"
  | "Maritime Subtropical"
  | "Desert"
  | "Continental Temperate"
  | "Maritime Temperate (Land)"
  | "Maritime Temperate (Sea)";

export type PropagationEnvironment = {
  radioClimate: RadioClimate;
  polarization: Polarization;
  clutterHeightM: number;
  groundDielectric: number;
  groundConductivity: number;
  atmosphericBendingNUnits: number;
};

export type MapViewport = {
  center: Coordinates;
  zoom: number;
};

export type RadioSystem = {
  id: string;
  name: string;
  txPowerDbm: number;
  txGainDbi: number;
  rxGainDbi: number;
  cableLossDb: number;
  antennaHeightM: number;
};

export type NetworkMembership = {
  siteId: string;
  systemId: string;
};

export type Network = {
  id: string;
  name: string;
  frequencyMHz: number;
  bandwidthKhz: number;
  spreadFactor: number;
  codingRate: number;
  frequencyOverrideMHz?: number;
  regionCode?: string;
  memberships: NetworkMembership[];
};

export type SrtmTile = {
  key: string;
  latStart: number;
  lonStart: number;
  size: number;
  width?: number;
  height?: number;
  arcSecondSpacing: 1 | 3;
  elevations: Int16Array;
  sourceKind?: "bundled" | "auto-fetch" | "manual-upload";
  sourceId?: string;
  sourceLabel?: string;
  sourceDetail?: string;
};

export type LinkAnalysis = {
  linkId: string;
  model: PropagationModel;
  distanceKm: number;
  pathLossDb: number;
  fsplDb: number;
  eirpDbm: number;
  rxLevelDbm: number;
  midpointEarthBulgeM: number;
  firstFresnelRadiusM: number;
  geometricClearanceM: number;
  estimatedFresnelClearancePercent: number;
};

export type ProfilePoint = {
  distanceKm: number;
  lat: number;
  lon: number;
  terrainM: number;
  losM: number;
  fresnelTopM: number;
  fresnelBottomM: number;
};

export type BestSiteCandidate = {
  lat: number;
  lon: number;
  worstRxDbm: number;
  avgRxDbm: number;
};

export type CoverageSample = {
  lat: number;
  lon: number;
  valueDbm: number;
};
