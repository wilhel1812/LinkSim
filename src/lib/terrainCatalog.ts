export const BUNDLED_SRTM1_TILES = [
  {
    key: "N59E010",
    archivePath: "/srtm1/N59E010.hgt.zip",
    sourceUrl: "https://www.ve2dbe.com/geodata/srtm1/N59E010.hgt.zip",
  },
  {
    key: "N59E011",
    archivePath: "/srtm1/N59E011.hgt.zip",
    sourceUrl: "https://www.ve2dbe.com/geodata/srtm1/N59E011.hgt.zip",
  },
  {
    key: "N60E009",
    archivePath: "/srtm1/N60E009.hgt.zip",
    sourceUrl: "https://www.ve2dbe.com/geodata/srtm1/N60E009.hgt.zip",
  },
] as const;

export const REMOTE_SRTM_ENDPOINTS = {
  srtm1: "https://www.ve2dbe.com/geodata/srtm1",
  srtm3: "https://www.ve2dbe.com/geodata/srtm3",
  srtmthird: "https://www.ve2dbe.com/geodata/srtmthird",
  landcover: "https://www.ve2dbe.com/geodata/landcover",
} as const;
