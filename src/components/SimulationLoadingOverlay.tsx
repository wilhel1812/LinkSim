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
  beforeLayerId?: string;
  bounds: TerrainBounds | null;
  handoffKey?: string | null;
  loading: boolean;
  onCloudEntered?: (handoffKey: string) => void;
  onCloudExited?: (handoffKey: string) => void;
  onCloudReady?: (handoffKey: string) => void;
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
  beforeLayerId,
  bounds,
  handoffKey = null,
  loading,
  onCloudEntered,
  onCloudExited,
  onCloudReady,
  pointMask,
}: SimulationLoadingOverlayProps) {
  const canvas = useMemo(() => document.createElement("canvas"), []);
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap();
  const reducedMotion = usePrefersReducedMotion();
  const ready = Boolean(bounds && pointMask);
  const addingToMapRef = useRef(false);
  const entryKeyRef = useRef<string | null>(null);
  const readyKeyRef = useRef<string | null>(null);
  const entryTimeoutRef = useRef<number | null>(null);
  const exitKeyRef = useRef<string | null>(null);
  const removalTimeoutRef = useRef<number | null>(null);
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
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
        map?.triggerRepaint();
        lastPaintAt = timestamp;
      }
      if (!reducedMotion) {
        frameId = window.requestAnimationFrame(paint);
      }
    };

    paint(startedAt);
    return () => window.cancelAnimationFrame(frameId);
  }, [bounds, canvas, loading, map, pointMask, reducedMotion]);

  useEffect(() => {
    if (!map) return;

    const removeFromMap = () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      entryKeyRef.current = null;
      readyKeyRef.current = null;
    };
    const clearPendingRemoval = () => {
      if (removalTimeoutRef.current !== null) {
        window.clearTimeout(removalTimeoutRef.current);
        removalTimeoutRef.current = null;
      }
    };
    const clearPendingEntry = () => {
      if (entryTimeoutRef.current !== null) {
        window.clearTimeout(entryTimeoutRef.current);
        entryTimeoutRef.current = null;
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
    const startExit = (key: string) => {
      applyTransition(false);
      exitKeyRef.current = key;
      removalTimeoutRef.current = window.setTimeout(() => {
        removeFromMap();
        removalTimeoutRef.current = null;
        const exitedKey = exitKeyRef.current;
        exitKeyRef.current = null;
        if (exitedKey) onCloudExited?.(exitedKey);
      }, LOADING_OVERLAY_EXIT_MS);
    };
    const scheduleEntry = (key: string, continuing: boolean) => {
      if (
        readyKeyRef.current === key ||
        entryTimeoutRef.current !== null
      ) {
        return;
      }
      readyKeyRef.current = key;
      onCloudReady?.(key);
      applyTransition(true);
      map.triggerRepaint();
      if (continuing) {
        onCloudEntered?.(key);
        return;
      }
      entryTimeoutRef.current = window.setTimeout(() => {
        entryTimeoutRef.current = null;
        onCloudEntered?.(key);
        if (!loadingRef.current) startExit(key);
      }, resolveSimulationOverlayTransition(true).durationMs);
    };

    const addToMap = (key: string, continuing: boolean) => {
      if (addingToMapRef.current) return;
      if (!coordinates) return;
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
          const layer = {
            id: LAYER_ID,
            paint: {
              "raster-opacity": transition.loadingOpacity,
              "raster-opacity-transition": {
                duration: transition.durationMs,
              },
            },
            source: SOURCE_ID,
            type: "raster" as const,
          };
          const anchorLayerId = beforeLayerId && map.getLayer(beforeLayerId)
            ? beforeLayerId
            : undefined;
          if (anchorLayerId) map.addLayer(layer, anchorLayerId);
          else map.addLayer(layer);
        } else if (beforeLayerId && map.getLayer(beforeLayerId)) {
          map.moveLayer(LAYER_ID, beforeLayerId);
        }
      } catch {
        // MapLibre can emit styledata before the style accepts custom sources.
        // Keep the listener active and retry on the next style update.
        return;
      } finally {
        addingToMapRef.current = false;
      }
      if (!map.getSource(SOURCE_ID) || !map.getLayer(LAYER_ID)) return;
      if (readyKeyRef.current === key) {
        applyTransition(true);
        return;
      }
      scheduleEntry(key, continuing);
    };

    const wasExiting = removalTimeoutRef.current !== null;
    const continuingEnteredCloud =
      loading &&
      entryKeyRef.current !== null &&
      entryKeyRef.current !== handoffKey &&
      entryTimeoutRef.current === null &&
      !wasExiting &&
      Boolean(map.getLayer(LAYER_ID));
    clearPendingRemoval();

    if (!ready || !coordinates || !handoffKey) {
      clearPendingEntry();
      removeFromMap();
      return;
    }

    if (!loading) {
      if (entryTimeoutRef.current !== null) return;
      startExit(handoffKey);
      return clearPendingRemoval;
    }

    if (entryKeyRef.current !== handoffKey) {
      clearPendingEntry();
      entryKeyRef.current = handoffKey;
    }

    const addAfterStyleChange = () =>
      addToMap(handoffKey, continuingEnteredCloud);
    map.on("styledata", addAfterStyleChange);
    addToMap(handoffKey, continuingEnteredCloud);

    return () => {
      map.off("styledata", addAfterStyleChange);
    };
  }, [
    beforeLayerId,
    canvas,
    coordinates,
    handoffKey,
    loading,
    map,
    onCloudEntered,
    onCloudExited,
    onCloudReady,
    ready,
  ]);

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
      if (entryTimeoutRef.current !== null) {
        window.clearTimeout(entryTimeoutRef.current);
      }
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    };
  }, [map]);

  return null;
}
