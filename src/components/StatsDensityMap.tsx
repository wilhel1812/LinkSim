import { useMemo, useRef, useState } from "react";
import { Fullscreen, ZoomIn, ZoomOut } from "lucide-react";
import Map, { Layer, Popup, Source, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import type { FeatureCollection, Point } from "geojson";
import { getCartoFallbackStyle } from "../lib/basemaps";
import type { StatsPayload } from "../lib/stats";
import type { UiColorTheme } from "../themes/types";
import { MapControlButton } from "./ui/MapControlButton";

type StatsDensityMapProps = {
  bins: StatsPayload["geography"]["bins"];
  theme: "light" | "dark";
  colorTheme?: UiColorTheme;
  accentColor: string;
  surfaceColor: string;
};

type DensityProperties = {
  count: number;
  label: string;
};

type HoveredBin = {
  count: number;
  label: string;
  longitude: number;
  latitude: number;
};

const colorVar = (name: string): string =>
  typeof window === "undefined"
    ? ""
    : getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const binLabel = (latBand: number, lonBand: number): string => {
  const latSuffix = latBand >= 0 ? "N" : "S";
  const lonSuffix = lonBand >= 0 ? "E" : "W";
  return `${Math.abs(latBand)} degrees ${latSuffix}, ${Math.abs(lonBand)} degrees ${lonSuffix}`;
};

const fitBins = (map: MapRef | null, bins: StatsDensityMapProps["bins"]) => {
  if (!map || !bins.length) return;
  const points = bins.map((bin) => [bin.lonBand + 0.5, bin.latBand + 0.5] as [number, number]);
  if (points.length === 1) {
    map.flyTo({ center: points[0], zoom: 6, duration: 500 });
    return;
  }
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  map.fitBounds(
    [
      [Math.min(...lons) - 0.8, Math.min(...lats) - 0.8],
      [Math.max(...lons) + 0.8, Math.max(...lats) + 0.8],
    ],
    { padding: 58, duration: 600 },
  );
};

export function StatsDensityMap({ bins, theme, colorTheme = "blue", accentColor, surfaceColor }: StatsDensityMapProps) {
  const mapRef = useRef<MapRef | null>(null);
  const [hovered, setHovered] = useState<HoveredBin | null>(null);
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count));
  const featureCollection = useMemo<FeatureCollection<Point, DensityProperties>>(
    () => ({
      type: "FeatureCollection",
      features: bins.map((bin) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [bin.lonBand + 0.5, bin.latBand + 0.5],
        },
        properties: {
          count: bin.count,
          label: binLabel(bin.latBand, bin.lonBand),
        },
      })),
    }),
    [bins],
  );

  const initialCenter = bins.length
    ? {
        longitude: bins.reduce((sum, bin) => sum + bin.lonBand + 0.5, 0) / bins.length,
        latitude: bins.reduce((sum, bin) => sum + bin.latBand + 0.5, 0) / bins.length,
      }
    : { longitude: 10, latitude: 60 };

  if (!bins.length) {
    return <div className="stats-empty">Site density will appear after Sites with coordinates are created.</div>;
  }

  return (
    <div className="stats-map-shell">
      <Map
        ref={mapRef}
        initialViewState={{ ...initialCenter, zoom: bins.length === 1 ? 5 : 3 }}
        mapStyle={getCartoFallbackStyle(theme, colorTheme)}
        attributionControl={{ compact: true }}
        dragPan={!window.matchMedia("(pointer: coarse)").matches}
        scrollZoom={false}
        touchZoomRotate={false}
        onError={() => setHovered(null)}
        onLoad={(event) => fitBins(event.target as unknown as MapRef, bins)}
        onMouseLeave={() => setHovered(null)}
        onMouseMove={(event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          const properties = feature?.properties as Partial<DensityProperties> | undefined;
          if (!feature || !properties || typeof properties.count !== "number") {
            setHovered(null);
            return;
          }
          setHovered({
            longitude: event.lngLat.lng,
            latitude: event.lngLat.lat,
            count: properties.count,
            label: String(properties.label ?? "Site density bin"),
          });
        }}
        onClick={(event: MapLayerMouseEvent) => {
          const feature = event.features?.[0];
          const properties = feature?.properties as Partial<DensityProperties> | undefined;
          if (!feature || !properties || typeof properties.count !== "number") return;
          setHovered({
            longitude: event.lngLat.lng,
            latitude: event.lngLat.lat,
            count: properties.count,
            label: String(properties.label ?? "Site density bin"),
          });
        }}
        interactiveLayerIds={["stats-density-bins"]}
      >
        <Source data={featureCollection} id="stats-density" type="geojson">
          <Layer
            id="stats-density-bins"
            type="circle"
            paint={{
              "circle-color": accentColor || colorVar("--accent"),
              "circle-blur": 0.18,
              "circle-opacity": 0.64,
              "circle-stroke-color": surfaceColor || colorVar("--surface"),
              "circle-stroke-opacity": 0.82,
              "circle-stroke-width": 1.5,
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["get", "count"],
                1,
                12,
                maxCount,
                42,
              ],
            }}
          />
        </Source>
        {hovered ? (
          <Popup closeButton={false} closeOnClick={false} latitude={hovered.latitude} longitude={hovered.longitude} offset={14}>
            <div className="stats-map-popup">
              <strong>{hovered.count} Sites</strong>
              <span>{hovered.label}</span>
            </div>
          </Popup>
        ) : null}
      </Map>
      <div className="map-controls map-controls-unified map-controls-icon-only stats-map-controls">
        <div className="map-controls-group map-controls-group-utility map-controls-utility-pill ui-surface-pill">
          <MapControlButton aria-label="Zoom out Site density map" onClick={() => mapRef.current?.zoomOut()} title="Zoom out">
            <ZoomOut aria-hidden="true" strokeWidth={1.8} />
          </MapControlButton>
          <MapControlButton aria-label="Zoom in Site density map" onClick={() => mapRef.current?.zoomIn()} title="Zoom in">
            <ZoomIn aria-hidden="true" strokeWidth={1.8} />
          </MapControlButton>
          <MapControlButton aria-label="Reset Site density map fit" onClick={() => fitBins(mapRef.current, bins)} title="Fit">
            <Fullscreen aria-hidden="true" strokeWidth={1.8} />
          </MapControlButton>
        </div>
      </div>
      <div className="floating-attribution-pill ui-surface-pill stats-map-attribution">
        <a href="https://carto.com/attributions" rel="noreferrer" target="_blank">CARTO</a>
        <span>·</span>
        <a href="https://github.com/maplibre/maplibre-gl-js" rel="noreferrer" target="_blank">MapLibre</a>
      </div>
    </div>
  );
}
