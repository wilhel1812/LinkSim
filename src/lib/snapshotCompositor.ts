// ---------------------------------------------------------------------------
// Public types shared between ExportFrame and ExportComposer
// ---------------------------------------------------------------------------

export type SnapshotDimensions = "auto" | "16:9" | "1:1" | "9:16";

export type SiteProjection = {
  id: string;
  name: string;
  normX: number;
  normY: number;
};
