import { describe, expect, it, vi } from "vitest";
import { handleSimulationLibraryLoad } from "./simulationLibraryLoad";

describe("handleSimulationLibraryLoad", () => {
  it("loads, persists, and closes for valid preset id", () => {
    const loadSimulationPreset = vi.fn();
    const persistSimulationRef = vi.fn();
    const closeLibraryModal = vi.fn();

    const handled = handleSimulationLibraryLoad({
      presetId: " sim-123 ",
      loadSimulationPreset,
      persistSimulationRef,
      closeLibraryModal,
    });

    expect(handled).toBe(true);
    expect(loadSimulationPreset).toHaveBeenCalledWith("sim-123");
    expect(persistSimulationRef).toHaveBeenCalledWith("sim-123");
    expect(closeLibraryModal).toHaveBeenCalledTimes(1);
  });

  it("does nothing for empty preset id", () => {
    const loadSimulationPreset = vi.fn();
    const persistSimulationRef = vi.fn();
    const closeLibraryModal = vi.fn();

    const handled = handleSimulationLibraryLoad({
      presetId: "  ",
      loadSimulationPreset,
      persistSimulationRef,
      closeLibraryModal,
    });

    expect(handled).toBe(false);
    expect(loadSimulationPreset).not.toHaveBeenCalled();
    expect(persistSimulationRef).not.toHaveBeenCalled();
    expect(closeLibraryModal).not.toHaveBeenCalled();
  });
});
