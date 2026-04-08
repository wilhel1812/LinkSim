type SimulationNameEntry = {
  id: string;
  name: string;
  ownerUserId?: string;
};

const normalizeSimulationName = (value: string): string => value.trim().toLowerCase();

export const hasDuplicateSimulationNameForOwner = (
  entries: SimulationNameEntry[],
  name: string,
  ownerUserId: string,
  ignorePresetId?: string,
): boolean => {
  const target = normalizeSimulationName(name);
  if (!target) return false;
  return entries.some(
    (entry) =>
      entry.id !== ignorePresetId &&
      entry.ownerUserId === ownerUserId &&
      normalizeSimulationName(entry.name) === target,
  );
};

export const duplicateSimulationNameMessage = (name: string): string => {
  const normalizedName = name.trim();
  if (!normalizedName) return "A unique Simulation name is required.";
  return `A Simulation named "${normalizedName}" already exists in your Library. Choose a unique name.`;
};
