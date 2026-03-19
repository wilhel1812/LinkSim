export type EditableResource = {
  id: string;
  ownerUserId?: string;
  effectiveRole?: string;
};

const hasEditAccess = (item: EditableResource, currentUser: { id: string } | null): boolean => {
  if (!currentUser) return false;
  if (item.ownerUserId === currentUser.id) return true;
  return item.effectiveRole === "owner" || item.effectiveRole === "admin" || item.effectiveRole === "editor";
};

export const canMutateActiveSimulation = (
  selectedSimulationRef: string,
  simulationPresets: EditableResource[],
  currentUser: { id: string } | null,
): boolean => {
  if (!selectedSimulationRef.startsWith("saved:")) return true;
  const presetId = selectedSimulationRef.replace("saved:", "");
  const preset = simulationPresets.find((entry) => entry.id === presetId);
  if (!preset) return false;
  return hasEditAccess(preset, currentUser);
};

export const countNonEditableResourceIds = (
  selectedIds: Set<string>,
  entries: EditableResource[],
  currentUser: { id: string } | null,
): number => {
  let nonEditable = 0;
  for (const id of selectedIds) {
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) continue;
    if (!hasEditAccess(entry, currentUser)) {
      nonEditable += 1;
    }
  }
  return nonEditable;
};

type MutationResource = "simulation" | "site" | "link" | "library-site";
type MutationAction = "create" | "save" | "remove" | "delete" | "update" | "insert";

export const getMutationPermissionMessage = (resource: MutationResource, action: MutationAction): string => {
  if (resource === "library-site" && action === "delete") {
    return "Cannot delete site: you do not have edit access to one or more selected Site Library entries.";
  }
  if (resource === "library-site" && action === "save") {
    return "Cannot save site: you do not have edit access to this Site Library entry.";
  }
  if (resource === "simulation") {
    return `Cannot ${action} simulation: you do not have edit access to this simulation.`;
  }
  if (resource === "site") {
    return `Cannot ${action} site: you do not have edit access to this simulation.`;
  }
  return `Cannot ${action} link: you do not have edit access to this simulation.`;
};
