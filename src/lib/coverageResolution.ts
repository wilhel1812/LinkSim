import type { CoverageResolution } from "../types/radio";

const COVERAGE_RESOLUTIONS: readonly CoverageResolution[] = ["24", "42", "84", "168"];

export const isCompatiblePersistedCoverageResolution = (value: unknown): boolean =>
  COVERAGE_RESOLUTIONS.includes(value as CoverageResolution)
  || value === "high"
  || value === "normal";

export const normalizeCoverageResolution = (value: unknown): CoverageResolution => {
  if (COVERAGE_RESOLUTIONS.includes(value as CoverageResolution)) return value as CoverageResolution;
  if (value === "high") return "42";
  return "24";
};
