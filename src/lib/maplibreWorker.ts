import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

let configured = false;

export const configureMapLibreWorker = (): void => {
  if (configured) return;
  setWorkerUrl(workerUrl);
  configured = true;
};
