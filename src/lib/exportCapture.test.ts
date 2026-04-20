// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

type DrawCall = {
  source: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type FilterCheck = {
  label: string;
  canvasAllowed: boolean;
  divAllowed: boolean;
};

const htmlToImage = vi.hoisted(() => ({
  toBlob: vi.fn(),
}));

vi.mock("html-to-image", () => ({
  toBlob: htmlToImage.toBlob,
}));

import { captureExportFrame } from "./exportCapture";

const blobLabels = new WeakMap<Blob, string>();

class FakeImage {
  naturalWidth = 400;
  naturalHeight = 300;
  onload: (() => void) | null = null;
  onerror: ((err?: unknown) => void) | null = null;
  private _src = "";

  set src(value: string) {
    this._src = value;
    queueMicrotask(() => {
      this.onload?.();
    });
  }

  get src(): string {
    return this._src;
  }
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  private readonly drawCalls: DrawCall[] = [];
  private readonly ctx = {
    scale: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    drawImage: (source: unknown, x: number, y: number, width: number, height: number) => {
      this.drawCalls.push({
        source: getSourceLabel(source),
        x,
        y,
        width,
        height,
      });
    },
  };

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext(type: string): typeof this.ctx | null {
    return type === "2d" ? this.ctx : null;
  }

  async convertToBlob(options: { type: string }): Promise<Blob> {
    return new Blob([JSON.stringify(this.drawCalls)], { type: options.type });
  }
}

const getSourceLabel = (source: unknown): string => {
  if (source instanceof FakeImage) return `image:${source.src}`;
  if (source && typeof source === "object") {
    const label = (source as { __sourceLabel?: string; kind?: string; label?: string }).__sourceLabel ??
      (source as { kind?: string }).kind ??
      (source as { label?: string }).label;
    if (label) return label;
    const ctorName = (source as { constructor?: { name?: string } }).constructor?.name;
    if (ctorName) return ctorName;
  }
  return typeof source;
};

const makeRect = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  x: left,
  y: top,
  toJSON() {
    return this;
  },
});

const setBox = (el: HTMLElement, rect: ReturnType<typeof makeRect>): void => {
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => rect,
  });
  Object.defineProperty(el, "offsetWidth", {
    value: rect.width,
  });
  Object.defineProperty(el, "offsetHeight", {
    value: rect.height,
  });
};

const setSourceLabel = (el: HTMLElement, label: string): void => {
  Object.defineProperty(el, "__sourceLabel", {
    value: label,
    configurable: true,
  });
};

const buildFrame = (options: {
  includeProfileCanvas?: boolean;
  includeResults?: boolean;
  includeFooter?: boolean;
} = {}): HTMLDivElement => {
  const {
    includeProfileCanvas = false,
    includeResults = true,
    includeFooter = true,
  } = options;

  const frame = document.createElement("div");
  frame.className = "export-frame";
  setBox(frame, makeRect(0, 0, 120, 160));

  const header = document.createElement("div");
  header.className = "export-frame-header";
  setBox(header, makeRect(0, 0, 120, 20));
  frame.appendChild(header);

  const mapSlot = document.createElement("div");
  mapSlot.className = "export-frame-map-slot";
  setBox(mapSlot, makeRect(0, 20, 120, 60));
  const mapCanvas = document.createElement("canvas");
  setSourceLabel(mapCanvas, "map-canvas");
  mapSlot.appendChild(mapCanvas);
  const siteMarker = document.createElement("div");
  siteMarker.className = "site-pin";
  siteMarker.textContent = "Site A";
  mapSlot.appendChild(siteMarker);
  frame.appendChild(mapSlot);

  const profileSlot = document.createElement("div");
  profileSlot.className = "export-frame-profile-slot";
  setBox(profileSlot, makeRect(0, 80, 120, 40));
  const chartHost = document.createElement("div");
  chartHost.className = "chart-host";
  setBox(chartHost, makeRect(0, 80, 120, 40));
  if (includeProfileCanvas) {
    const terrainCanvas = document.createElement("canvas");
    terrainCanvas.className = "panorama-terrain-canvas";
    setSourceLabel(terrainCanvas, "terrain-canvas");
    chartHost.appendChild(terrainCanvas);
  } else {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Profile");
    chartHost.appendChild(svg);
  }
  profileSlot.appendChild(chartHost);
  frame.appendChild(profileSlot);

  if (includeResults) {
    const resultsSlot = document.createElement("div");
    resultsSlot.className = "export-frame-results-slot";
    setBox(resultsSlot, makeRect(0, 120, 120, 25));
    frame.appendChild(resultsSlot);
  }

  if (includeFooter) {
    const footer = document.createElement("div");
    footer.className = "export-frame-footer";
    setBox(footer, makeRect(0, 145, 120, 15));
    frame.appendChild(footer);
  }

  return frame as HTMLDivElement;
};

const parseDrawCalls = async (blob: Blob): Promise<DrawCall[]> => JSON.parse(await blob.text()) as DrawCall[];

describe("captureExportFrame", () => {
  beforeEach(() => {
    htmlToImage.toBlob.mockReset();
    filterChecks.length = 0;
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
    vi.stubGlobal("createImageBitmap", vi.fn(async (blob: Blob) => ({
      __sourceLabel: blobLabels.get(blob) ?? "bitmap",
      close: vi.fn(),
    })));

    htmlToImage.toBlob.mockImplementation(async (el: HTMLElement, options?: { filter?: (node: Element) => boolean }) => {
      const label =
        el.classList.contains("export-frame-header")
          ? "header-dom"
          : el.classList.contains("export-frame-map-slot")
            ? "map-slot-dom"
            : el.classList.contains("export-frame-profile-slot")
              ? "profile-slot-dom"
              : el.classList.contains("export-frame-results-slot")
                ? "results-slot-dom"
                : el.classList.contains("export-frame-footer")
                  ? "footer-dom"
                  : "dom";

      if (options?.filter) {
        const canvasProbe = document.createElement("canvas");
        const divProbe = document.createElement("div");
        filterChecks.push({
          label,
          canvasAllowed: options.filter(canvasProbe),
          divAllowed: options.filter(divProbe),
        });
      }

      const blob = new Blob([label], { type: "image/png" });
      blobLabels.set(blob, label);
      return blob;
    });
  });

  const filterChecks: FilterCheck[] = [];

  it("draws the map first and then overlays transparent site markers on top", async () => {
    const frame = buildFrame();

    const blob = await captureExportFrame(frame, "data:image/png;base64,map-snapshot");
    const calls = await parseDrawCalls(blob);

    expect(calls.slice(0, 3).map((call) => call.source)).toEqual([
      "header-dom",
      "image:data:image/png;base64,map-snapshot",
      "map-slot-dom",
    ]);
    expect(calls.findIndex((call) => call.source === "image:data:image/png;base64,map-snapshot")).toBeLessThan(
      calls.findIndex((call) => call.source === "map-slot-dom"),
    );

    const mapSlotFilter = filterChecks.find((check) => check.label === "map-slot-dom");
    expect(mapSlotFilter).toMatchObject({
      canvasAllowed: false,
      divAllowed: true,
    });
  });

  it("overwrites the panorama foreignObject fallback by drawing the terrain canvas directly", async () => {
    const frame = buildFrame({ includeProfileCanvas: true });

    const blob = await captureExportFrame(frame, "data:image/png;base64,map-snapshot");
    const calls = await parseDrawCalls(blob);

    expect(calls.map((call) => call.source)).toContain("terrain-canvas");
    expect(calls.findIndex((call) => call.source === "profile-slot-dom")).toBeLessThan(
      calls.findIndex((call) => call.source === "terrain-canvas"),
    );
  });

  it("keeps the path profile export on the DOM/SVG capture path", async () => {
    const frame = buildFrame({ includeProfileCanvas: false });

    const blob = await captureExportFrame(frame, "data:image/png;base64,map-snapshot");
    const calls = await parseDrawCalls(blob);

    expect(calls.map((call) => call.source)).not.toContain("terrain-canvas");
    expect(calls.map((call) => call.source)).toContain("profile-slot-dom");
    expect(calls.map((call) => call.source)).toContain("results-slot-dom");
  });
});
