import { useEffect, useRef } from "react";
import { useMap } from "react-map-gl/maplibre";
import type { Map as MapLibreMap, StyleSpecification } from "maplibre-gl";
import {
  captureBasemapPaintSnapshot,
  resolveBasemapPaintUpdates,
  type BasemapPaintSnapshotEntry,
} from "../lib/basemapThemeTint";
import type { UiColorTheme, UiThemeMode } from "../themes/types";

type BasemapThemeTintProps = {
  colorTheme: UiColorTheme;
  enabled: boolean;
  theme: UiThemeMode;
};

type PaintPropertyName = Parameters<MapLibreMap["setPaintProperty"]>[1];
type PaintPropertyValue = Parameters<MapLibreMap["setPaintProperty"]>[2];

const setBasemapPaintProperty = (
  map: MapLibreMap,
  update: BasemapPaintSnapshotEntry,
): void => {
  map.setPaintProperty(
    update.layerId,
    update.property as PaintPropertyName,
    update.value as PaintPropertyValue,
  );
};

export function BasemapThemeTint({ colorTheme, enabled, theme }: BasemapThemeTintProps) {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap();
  const snapshotRef = useRef<BasemapPaintSnapshotEntry[]>([]);
  const settingsRef = useRef({ colorTheme, enabled, theme });

  useEffect(() => {
    settingsRef.current = { colorTheme, enabled, theme };
  }, [colorTheme, enabled, theme]);

  useEffect(() => {
    if (!map) return;
    const apply = () => {
      const settings = settingsRef.current;
      for (const update of resolveBasemapPaintUpdates(snapshotRef.current, settings.enabled, settings.colorTheme, settings.theme)) {
        if (map.getLayer(update.layerId)) setBasemapPaintProperty(map, update);
      }
    };
    const captureAndApply = () => {
      snapshotRef.current = captureBasemapPaintSnapshot(map.getStyle() as StyleSpecification);
      apply();
    };

    map.on("style.load", captureAndApply);
    if (map.isStyleLoaded()) captureAndApply();
    return () => {
      map.off("style.load", captureAndApply);
      for (const update of resolveBasemapPaintUpdates(snapshotRef.current, false, settingsRef.current.colorTheme, settingsRef.current.theme)) {
        if (map.getLayer(update.layerId)) setBasemapPaintProperty(map, update);
      }
      snapshotRef.current = [];
    };
  }, [map]);

  useEffect(() => {
    if (!map || snapshotRef.current.length === 0) return;
    for (const update of resolveBasemapPaintUpdates(snapshotRef.current, enabled, colorTheme, theme)) {
      if (map.getLayer(update.layerId)) setBasemapPaintProperty(map, update);
    }
  }, [colorTheme, enabled, map, theme]);

  return null;
}
