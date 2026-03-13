export const REMOTE_SRTM_ENDPOINTS = {
  srtm1: "https://copernicus-dem-30m.s3.amazonaws.com/readme.html",
  srtm3: "https://copernicus-dem-90m.s3.amazonaws.com/readme.html",
  srtmthird: "https://www.ve2dbe.com/geodata/srtmthird",
  landcover: "https://www.ve2dbe.com/geodata/landcover",
} as const;

export const PRIMARY_ATTRIBUTION = {
  projectName: "Radio Mobile",
  projectUrl: "https://www.ve2dbe.com",
  authorName: "Roger Coudé (VE2DBE)",
  disclaimer: "",
} as const;
