export type PanoramaFocusPoint = {
  siteId: string;
  azimuthDeg: number;
  endpoint: { lat: number; lon: number };
  horizonDistanceKm: number;
};

export type PanoramaInteractionEvent =
  | { type: "hover"; payload: PanoramaFocusPoint }
  | { type: "leave"; siteId: string }
  | { type: "toggle-lock"; payload: PanoramaFocusPoint }
  | { type: "clear"; siteId: string };

const EVENT_NAME = "panorama-interaction";

export const dispatchPanoramaInteraction = (event: PanoramaInteractionEvent): void => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<PanoramaInteractionEvent>(EVENT_NAME, { detail: event }));
};

export const subscribePanoramaInteraction = (onEvent: (event: PanoramaInteractionEvent) => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  const handler = (raw: Event) => {
    const custom = raw as CustomEvent<PanoramaInteractionEvent>;
    if (!custom.detail) return;
    onEvent(custom.detail);
  };
  window.addEventListener(EVENT_NAME, handler as EventListener);
  return () => {
    window.removeEventListener(EVENT_NAME, handler as EventListener);
  };
};
