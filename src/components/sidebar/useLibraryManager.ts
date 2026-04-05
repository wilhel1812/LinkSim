import { useState } from "react";
import type { LibraryFilterState } from "../../lib/libraryFilters";

type UseLibraryManagerParams = {
  initialFilters: LibraryFilterState;
};

export function useLibraryManager({ initialFilters }: UseLibraryManagerParams) {
  const [showSimulationLibraryManager, setShowSimulationLibraryManager] = useState(false);
  const [showSiteLibraryManager, setShowSiteLibraryManager] = useState(false);
  const [siteLibraryFilters, setSiteLibraryFilters] = useState<LibraryFilterState>(initialFilters);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<string>>(new Set());
  const [showAddLibraryForm, setShowAddLibraryForm] = useState(false);

  const toggleLibrarySelection = (entryId: string) => {
    setSelectedLibraryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  return {
    showSimulationLibraryManager,
    setShowSimulationLibraryManager,
    showSiteLibraryManager,
    setShowSiteLibraryManager,
    siteLibraryFilters,
    setSiteLibraryFilters,
    selectedLibraryIds,
    setSelectedLibraryIds,
    selectedLibraryCount: selectedLibraryIds.size,
    showAddLibraryForm,
    setShowAddLibraryForm,
    toggleLibrarySelection,
  };
}
