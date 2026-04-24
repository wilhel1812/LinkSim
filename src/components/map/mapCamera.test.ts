import { describe, expect, it, vi } from "vitest";
import {
  MAP_CAMERA_ANIMATION_MS,
  animateMapToCenter,
  animateMapToZoom,
  fitMapToBounds,
  mapCameraOffsetForPadding,
  resolveMapCameraPadding,
} from "./mapCamera";

describe("map camera helpers", () => {
  it("resolves shared fit and center padding from app chrome measurements", () => {
    expect(resolveMapCameraPadding({ top: 30, right: 70, bottom: 30, left: 320 }, 280)).toEqual({
      top: 30,
      right: 70,
      bottom: 280,
      left: 320,
    });
  });

  it("moves the target to the center of panel-free map space", () => {
    expect(mapCameraOffsetForPadding({ top: 30, right: 70, bottom: 30, left: 320 })).toEqual([125, 0]);
    expect(mapCameraOffsetForPadding({ top: 30, right: 70, bottom: 280, left: 70 })).toEqual([0, -125]);
  });

  it("animates centered camera moves with the shared offset", () => {
    const easeTo = vi.fn();

    animateMapToCenter(
      { current: { easeTo } },
      {
        center: { lat: 60.5, lon: 11.5 },
        zoom: 12,
        padding: { top: 30, right: 70, bottom: 280, left: 320 },
      },
    );

    expect(easeTo).toHaveBeenCalledWith({
      center: [11.5, 60.5],
      zoom: 12,
      offset: [125, -125],
      duration: MAP_CAMERA_ANIMATION_MS,
      essential: true,
    });
  });

  it("animates zoom-only camera moves with the shared offset", () => {
    const easeTo = vi.fn();

    animateMapToZoom(
      { current: { easeTo } },
      {
        zoom: 9,
        padding: { top: 30, right: 70, bottom: 30, left: 320 },
      },
    );

    expect(easeTo).toHaveBeenCalledWith({
      zoom: 9,
      offset: [125, 0],
      duration: MAP_CAMERA_ANIMATION_MS,
      essential: true,
    });
  });

  it("fits bounds through the shared animated fit options", () => {
    const fitBounds = vi.fn();
    const bounds: [[number, number], [number, number]] = [[10, 59], [12, 61]];

    fitMapToBounds(
      { current: { fitBounds } },
      bounds,
      {
        padding: { top: 30, right: 70, bottom: 280, left: 320 },
        maxZoom: 14,
      },
    );

    expect(fitBounds).toHaveBeenCalledWith(bounds, {
      padding: { top: 30, right: 70, bottom: 280, left: 320 },
      animate: true,
      linear: false,
      duration: MAP_CAMERA_ANIMATION_MS,
      maxZoom: 14,
    });
  });
});
