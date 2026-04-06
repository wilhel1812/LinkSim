type HandleSimulationLibraryLoadInput = {
  presetId: string;
  loadSimulationPreset: (presetId: string) => void;
  persistSimulationRef?: (presetId: string) => void;
  closeLibraryModal?: () => void;
};

export const handleSimulationLibraryLoad = ({
  presetId,
  loadSimulationPreset,
  persistSimulationRef,
  closeLibraryModal,
}: HandleSimulationLibraryLoadInput): boolean => {
  const normalizedPresetId = String(presetId ?? "").trim();
  if (!normalizedPresetId) return false;
  loadSimulationPreset(normalizedPresetId);
  persistSimulationRef?.(normalizedPresetId);
  closeLibraryModal?.();
  return true;
};
