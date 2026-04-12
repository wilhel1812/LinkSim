import { useState } from "react";
import type { RefObject } from "react";
import type { MapRef } from "react-map-gl/maplibre";

type ViewState = {
  zoom: number;
};

type UseMapControlsParams = {
  activeViewState: ViewState;
  fitBottomInset: number;
  mapRef: RefObject<MapRef | null>;
  providerMaxZoom: number;
  sites: Array<{ position: { lat: number; lon: number } }>;
  computeSiteFitBounds: (sites: Array<{ position: { lat: number; lon: number } }>) => [[number, number], [number, number]] | null;
  fitChromePadding: { left: number; right: number; top: number; bottom: number };
  clamp: (value: number, min: number, max: number) => number;
  setInteractionViewState: (value: null) => void;
  updateMapViewport: (patch: { zoom?: number }) => void;
};

export const computeNextZoom = (
  currentZoom: number,
  delta: number,
  providerMaxZoom: number,
  clamp: (value: number, min: number, max: number) => number,
) => clamp(currentZoom + delta, 2, providerMaxZoom);

export const computeNextAutoFitEnabledAfterInteraction = (): boolean => false;

export const computeNextAutoFitEnabledAfterFitToggle = (current: boolean): boolean => !current;

export function useMapControls({
  activeViewState,
  fitBottomInset,
  mapRef,
  providerMaxZoom,
  sites,
  computeSiteFitBounds,
  fitChromePadding,
  clamp,
  setInteractionViewState,
  updateMapViewport,
}: UseMapControlsParams) {
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [fitControlActive, setFitControlActive] = useState(true);

  const zoomBy = (delta: number) => {
    setFitControlActive(computeNextAutoFitEnabledAfterInteraction());
    const nextZoom = computeNextZoom(activeViewState.zoom, delta, providerMaxZoom, clamp);
    setInteractionViewState(null);
    updateMapViewport({ zoom: nextZoom });
  };

  const fitToNodes = () => {
    const nextEnabled = computeNextAutoFitEnabledAfterFitToggle(fitControlActive);
    setFitControlActive(nextEnabled);
    if (!nextEnabled) return;
    if (!mapRef.current) return;
    const bounds = computeSiteFitBounds(sites);
    if (!bounds) return;
    setInteractionViewState(null);
    mapRef.current.fitBounds(bounds, {
      padding: { ...fitChromePadding, bottom: fitBottomInset },
      animate: true,
      maxZoom: 14,
    });
  };

  return {
    isMultiSelectMode,
    setIsMultiSelectMode,
    fitControlActive,
    clearFitControlActive: () => setFitControlActive(computeNextAutoFitEnabledAfterInteraction()),
    zoomBy,
    fitToNodes,
  };
}
