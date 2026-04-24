import type { RefObject } from "react";

export type MapCameraPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

type MapCameraRef = RefObject<{
  easeTo?: (options: {
    center?: [number, number];
    zoom?: number;
    offset?: [number, number];
    duration?: number;
    essential?: boolean;
  }) => void;
  fitBounds?: (
    bounds: [[number, number], [number, number]],
    options: {
      padding: MapCameraPadding;
      animate: boolean;
      linear: boolean;
      duration: number;
      maxZoom?: number;
    },
  ) => void;
} | null>;

export const MAP_CAMERA_ANIMATION_MS = 900;

export const resolveMapCameraPadding = (
  fitChromePadding: MapCameraPadding,
  fitBottomInset: number,
): MapCameraPadding => ({
  ...fitChromePadding,
  bottom: fitBottomInset,
});

export const mapCameraOffsetForPadding = (padding: MapCameraPadding): [number, number] => [
  (padding.left - padding.right) / 2,
  (padding.top - padding.bottom) / 2,
];

export const animateMapToCenter = (
  mapRef: MapCameraRef,
  {
    center,
    zoom,
    padding,
    duration = MAP_CAMERA_ANIMATION_MS,
  }: {
    center: { lat: number; lon: number };
    zoom: number;
    padding: MapCameraPadding;
    duration?: number;
  },
): boolean => {
  const map = mapRef.current;
  if (!map?.easeTo) return false;
  map.easeTo({
    center: [center.lon, center.lat],
    zoom,
    offset: mapCameraOffsetForPadding(padding),
    duration,
    essential: true,
  });
  return true;
};

export const animateMapToZoom = (
  mapRef: MapCameraRef,
  {
    zoom,
    padding,
    duration = MAP_CAMERA_ANIMATION_MS,
  }: {
    zoom: number;
    padding: MapCameraPadding;
    duration?: number;
  },
): boolean => {
  const map = mapRef.current;
  if (!map?.easeTo) return false;
  map.easeTo({
    zoom,
    offset: mapCameraOffsetForPadding(padding),
    duration,
    essential: true,
  });
  return true;
};

export const fitMapToBounds = (
  mapRef: MapCameraRef,
  bounds: [[number, number], [number, number]],
  {
    padding,
    maxZoom,
    duration = MAP_CAMERA_ANIMATION_MS,
  }: {
    padding: MapCameraPadding;
    maxZoom?: number;
    duration?: number;
  },
): boolean => {
  const map = mapRef.current;
  if (!map?.fitBounds) return false;
  map.fitBounds(bounds, {
    padding,
    animate: true,
    linear: false,
    duration,
    maxZoom,
  });
  return true;
};
