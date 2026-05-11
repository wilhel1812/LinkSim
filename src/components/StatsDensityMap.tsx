import { useMemo, useRef, useState, type CSSProperties } from "react";
import Map, { Layer, NavigationControl, Source, type MapRef } from "react-map-gl/maplibre";
import type { FeatureCollection, Point } from "geojson";
import { getCartoFallbackStyle } from "../lib/basemaps";
import type { StatsPayload } from "../lib/stats";
import type { UiColorTheme } from "../themes/types";

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
  xPercent: number;
  yPercent: number;
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
  const overlayBins = useMemo(() => {
    if (!bins.length) return [];
    const points = bins.map((bin) => ({
      count: bin.count,
      label: binLabel(bin.latBand, bin.lonBand),
      longitude: bin.lonBand + 0.5,
      latitude: bin.latBand + 0.5,
    }));
    const lons = points.map((point) => point.longitude);
    const lats = points.map((point) => point.latitude);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const lonSpan = Math.max(1, maxLon - minLon);
    const latSpan = Math.max(1, maxLat - minLat);
    return points.map((point) => ({
      ...point,
      xPercent: 8 + ((point.longitude - minLon) / lonSpan) * 76,
      yPercent: 84 - ((point.latitude - minLat) / latSpan) * 66,
    }));
  }, [bins]);
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
        cooperativeGestures
        onError={() => setHovered(null)}
        onLoad={(event) => fitBins(event.target as unknown as MapRef, bins)}
        onMouseLeave={() => setHovered(null)}
        interactiveLayerIds={["stats-density-bins"]}
      >
        <NavigationControl position="top-left" showCompass={false} />
        <Source data={featureCollection} id="stats-density" type="geojson">
          <Layer
            id="stats-density-bins"
            type="circle"
            paint={{
              "circle-color": accentColor || colorVar("--accent"),
              "circle-opacity": 0.34,
              "circle-stroke-color": surfaceColor || colorVar("--surface"),
              "circle-stroke-opacity": 0.94,
              "circle-stroke-width": 2,
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["get", "count"],
                1,
                9,
                maxCount,
                30,
              ],
            }}
          />
        </Source>
      </Map>
      <div className="stats-map-marker-layer" aria-label="Binned Site density markers">
        {overlayBins.map((bin) => {
          const intensity = Math.max(0.35, bin.count / maxCount);
          const size = 24 + intensity * 42;
          return (
            <button
              aria-label={`${bin.count} Sites near ${bin.label}`}
              className="stats-map-marker"
              key={bin.label}
              onBlur={() => setHovered(null)}
              onClick={(event) => {
                event.stopPropagation();
                setHovered(bin);
              }}
              onFocus={() => setHovered(bin)}
              onMouseEnter={() => setHovered(bin)}
              onMouseLeave={() => setHovered(null)}
              style={
                {
                  "--marker-size": `${size}px`,
                  left: `${bin.xPercent}%`,
                  top: `${bin.yPercent}%`,
                } as CSSProperties
              }
              title={`${bin.count} Sites near ${bin.label}`}
              type="button"
            >
              <span>{bin.count}</span>
            </button>
          );
        })}
        {hovered ? (
          <div
            className="stats-map-popup"
            style={{ left: `${hovered.xPercent}%`, top: `${hovered.yPercent}%` }}
          >
            <strong>{hovered.count} Sites</strong>
            <span>{hovered.label}</span>
          </div>
        ) : null}
      </div>
      <button
        aria-label="Reset Site density map fit"
        className="stats-map-reset btn-ghost"
        onClick={() => fitBins(mapRef.current, bins)}
        type="button"
      >
        Reset fit
      </button>
      <div className="stats-map-legend" aria-label="Site density legend">
        <span>Site density</span>
        <i />
      </div>
    </div>
  );
}
