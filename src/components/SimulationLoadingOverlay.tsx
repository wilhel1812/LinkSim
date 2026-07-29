import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMap } from "react-map-gl/maplibre";
import type { CanvasSource } from "maplibre-gl";
import type { TerrainBounds } from "../lib/overlayRaster";
import {
  buildDriftingCloudPixels,
  loadingOverlayCoordinates,
  LOADING_OVERLAY_EXIT_MS,
  resolveDriftingCloudPhase,
  resolveLoadingOverlayDimensions,
  resolveSimulationOverlayTransition,
} from "../lib/simulationLoadingOverlay";

const CLOUD_FRAME_INTERVAL_MS = 50;
const SOURCE_ID = "simulation-loading-overlay-source";
const LAYER_ID = "simulation-loading-overlay-layer";

type SimulationLoadingOverlayProps = {
  bounds: TerrainBounds | null;
  loading: boolean;
  pointMask?: (lat: number, lon: number) => boolean;
};

const usePrefersReducedMotion = (): boolean => {
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reducedMotion;
};

export function SimulationLoadingOverlay({
  bounds,
  loading,
  pointMask,
}: SimulationLoadingOverlayProps) {
  const canvas = useMemo(() => document.createElement("canvas"), []);
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap();
  const reducedMotion = usePrefersReducedMotion();
  const ready = Boolean(bounds && pointMask);
  const addingToMapRef = useRef(false);
  const removalTimeoutRef = useRef<number | null>(null);
  const fadeInFrameRef = useRef<number | null>(null);
  const coordinates = useMemo(
    () => (bounds ? loadingOverlayCoordinates(bounds) : null),
    [bounds],
  );

  useEffect(() => {
    if (!loading || !bounds || !pointMask) return;
    const dimensions = resolveLoadingOverlayDimensions(bounds);
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) return;

    const startedAt = performance.now();
    let frameId = 0;
    let lastPaintAt = Number.NEGATIVE_INFINITY;
    const paint = (timestamp: number) => {
      if (
        reducedMotion ||
        timestamp - lastPaintAt >= CLOUD_FRAME_INTERVAL_MS
      ) {
        const frame = buildDriftingCloudPixels({
          bounds,
          width: dimensions.width,
          height: dimensions.height,
          phase: resolveDriftingCloudPhase(
            timestamp - startedAt,
            reducedMotion,
          ),
          pointMask,
        });
        const image = context.createImageData(frame.width, frame.height);
        image.data.set(frame.pixels);
        context.putImageData(image, 0, 0);
        lastPaintAt = timestamp;
      }
      if (!reducedMotion) {
        frameId = window.requestAnimationFrame(paint);
      }
    };

    frameId = window.requestAnimationFrame(paint);
    return () => window.cancelAnimationFrame(frameId);
  }, [bounds, canvas, loading, pointMask, reducedMotion]);

  useEffect(() => {
    if (!map) return;

    const removeFromMap = () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
    const clearPendingRemoval = () => {
      if (removalTimeoutRef.current !== null) {
        window.clearTimeout(removalTimeoutRef.current);
        removalTimeoutRef.current = null;
      }
    };
    const clearPendingFadeIn = () => {
      if (fadeInFrameRef.current !== null) {
        window.cancelAnimationFrame(fadeInFrameRef.current);
        fadeInFrameRef.current = null;
      }
    };
    const applyTransition = (entering: boolean) => {
      if (!map.getLayer(LAYER_ID)) return;
      const transition = resolveSimulationOverlayTransition(entering);
      map.setPaintProperty(LAYER_ID, "raster-opacity-transition", {
        duration: transition.durationMs,
      });
      map.setPaintProperty(
        LAYER_ID,
        "raster-opacity",
        transition.loadingOpacity,
      );
    };

    const addToMap = () => {
      if (addingToMapRef.current) return;
      if (!coordinates || !map.isStyleLoaded()) return;
      if (map.getSource(SOURCE_ID) && map.getLayer(LAYER_ID)) return;
      addingToMapRef.current = true;
      try {
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, {
            animate: true,
            canvas,
            coordinates,
            type: "canvas",
          });
        }
        if (!map.getLayer(LAYER_ID)) {
          const transition = resolveSimulationOverlayTransition(false);
          map.addLayer({
            id: LAYER_ID,
            paint: {
              "raster-opacity": transition.loadingOpacity,
              "raster-opacity-transition": {
                duration: transition.durationMs,
              },
            },
            source: SOURCE_ID,
            type: "raster",
          });
        }
        applyTransition(true);
      } finally {
        addingToMapRef.current = false;
      }
    };

    clearPendingRemoval();
    clearPendingFadeIn();

    if (!ready || !coordinates) {
      removeFromMap();
      return;
    }

    if (!loading) {
      applyTransition(false);
      removalTimeoutRef.current = window.setTimeout(() => {
        removeFromMap();
        removalTimeoutRef.current = null;
      }, LOADING_OVERLAY_EXIT_MS);
      return clearPendingRemoval;
    }

    const addAfterStyleChange = () => addToMap();
    map.on("styledata", addAfterStyleChange);

    if (map.isStyleLoaded()) {
      addingToMapRef.current = true;
      try {
        if (!map.getSource(SOURCE_ID)) {
          map.addSource(SOURCE_ID, {
            animate: true,
            canvas,
            coordinates,
            type: "canvas",
          });
        }
        if (!map.getLayer(LAYER_ID)) {
          const transition = resolveSimulationOverlayTransition(false);
          map.addLayer({
            id: LAYER_ID,
            paint: {
              "raster-opacity": transition.loadingOpacity,
              "raster-opacity-transition": {
                duration: transition.durationMs,
              },
            },
            source: SOURCE_ID,
            type: "raster",
          });
        }
      } finally {
        addingToMapRef.current = false;
      }
      fadeInFrameRef.current = window.requestAnimationFrame(() => {
        fadeInFrameRef.current = null;
        applyTransition(true);
      });
    }

    return () => {
      map.off("styledata", addAfterStyleChange);
      clearPendingFadeIn();
    };
  }, [canvas, coordinates, loading, map, ready]);

  useEffect(() => {
    if (!map || !loading || !coordinates) return;
    const source = map.getSource(SOURCE_ID) as CanvasSource | undefined;
    source?.setCoordinates(coordinates);
  }, [coordinates, loading, map]);

  useEffect(() => {
    if (!map) return;
    return () => {
      if (removalTimeoutRef.current !== null) {
        window.clearTimeout(removalTimeoutRef.current);
      }
      if (fadeInFrameRef.current !== null) {
        window.cancelAnimationFrame(fadeInFrameRef.current);
      }
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map]);

  return null;
}
