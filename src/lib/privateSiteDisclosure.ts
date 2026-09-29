type SimulationWithSiteReferences = {
  snapshot?: {
    sites?: Array<{ libraryEntryId?: unknown } | null>;
  } | null;
} | null;

type LibrarySiteVisibility = {
  id?: unknown;
  visibility?: unknown;
};

export const getReferencedPrivateSiteIds = (
  simulation: SimulationWithSiteReferences,
  siteLibrary: LibrarySiteVisibility[],
): string[] => {
  const referencedIds = new Set<string>();
  for (const site of simulation?.snapshot?.sites ?? []) {
    const id = typeof site?.libraryEntryId === "string" ? site.libraryEntryId.trim() : "";
    if (id) referencedIds.add(id);
  }

  const privateIds = new Set<string>();
  for (const site of siteLibrary) {
    const id = typeof site.id === "string" ? site.id.trim() : "";
    if (id && referencedIds.has(id) && toAccessVisibility(site.visibility) === "private") {
      privateIds.add(id);
    }
  }
  return [...privateIds].sort();
};
import { toAccessVisibility } from "./uiFormatting";
