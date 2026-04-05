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
  const [fitControlActive, setFitControlActive] = useState(false);

  const zoomBy = (delta: number) => {
    setFitControlActive(false);
    const nextZoom = clamp(activeViewState.zoom + delta, 2, providerMaxZoom);
    setInteractionViewState(null);
    updateMapViewport({ zoom: nextZoom });
  };

  const fitToNodes = () => {
    if (!mapRef.current) return;
    const bounds = computeSiteFitBounds(sites);
    if (!bounds) return;
    setFitControlActive(true);
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
    clearFitControlActive: () => setFitControlActive(false),
    zoomBy,
    fitToNodes,
  };
}
