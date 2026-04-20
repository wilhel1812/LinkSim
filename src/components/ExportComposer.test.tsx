// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({
  captureExportFrame: vi.fn(),
}));

vi.mock("../lib/exportCapture", () => ({
  captureExportFrame: mocks.captureExportFrame,
}));

vi.mock("../hooks/useUiTheme", () => ({
  useUiTheme: () => ({
    preference: "system",
    setPreference: vi.fn(),
    colorTheme: "green",
    setColorTheme: vi.fn(),
  }),
}));

vi.mock("./ExportFrame", () => ({
  ExportFrame: React.forwardRef<HTMLDivElement>(function MockExportFrame(_props, ref) {
    return <div ref={ref} data-testid="export-frame" />;
  }),
}));

import { ExportComposer } from "./ExportComposer";

describe("ExportComposer print flow", () => {
  const printMock = vi.fn();
  const createObjectURLMock = vi.fn(() => "blob:print-image");
  const revokeObjectURLMock = vi.fn();

  beforeEach(() => {
    mocks.captureExportFrame.mockReset();
    printMock.mockReset();
    createObjectURLMock.mockClear();
    revokeObjectURLMock.mockClear();
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
    vi.spyOn(window, "print").mockImplementation(printMock);
    vi.spyOn(URL, "createObjectURL").mockImplementation(createObjectURLMock);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(revokeObjectURLMock);
    mocks.captureExportFrame.mockResolvedValue(new Blob(["print"], { type: "image/png" }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the composed export image instead of the live DOM", async () => {
    const user = userEvent.setup();
    const { getByRole, container } = render(
      <ExportComposer
        mapViewHandle={null}
        panoramaHandle={null}
        profileAvailable={true}
        isSingleSiteSelection={false}
        isLinkSelected={true}
        shareUrl={null}
        simulationName="Chamonix"
        profileLabel="Chamonix centre → Aiguille du Midi"
      />,
    );

    await user.click(getByRole("button", { name: "Print" }));

    await waitFor(() => {
      expect(mocks.captureExportFrame).toHaveBeenCalled();
      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
    });

    const image = container.ownerDocument.querySelector(".export-print-image") as HTMLImageElement | null;
    expect(image).toBeTruthy();

    if (!image) throw new Error("print image missing");
    await act(async () => {
      fireEvent.load(image);
    });

    await waitFor(() => {
      expect(printMock).toHaveBeenCalledTimes(1);
    });

    expect(mocks.captureExportFrame).toHaveBeenCalledWith(expect.any(HTMLDivElement), null);
    await act(async () => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:print-image");
  });
});
