// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinkProfileEmptyState } from "./LinkProfileChart";

vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, String(value)),
    removeItem: (key: string) => data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  });
});

const noPathMessage =
  "Select exactly two sites, or choose a saved link, to show path profile and LOS/Fresnel analysis.";
const multiSiteMessage =
  "Select exactly two sites, or choose a saved link, to show path profile analysis.";

describe("LinkProfileEmptyState", () => {
  it.each([noPathMessage, multiSiteMessage])(
    "keeps the toolbar and supplied row controls for guidance text",
    (message) => {
      render(
        <LinkProfileEmptyState
          message={message}
          rowControls={<button type="button">Hide Profile</button>}
        />,
      );

      expect(screen.getByText("Path Profile")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Hide Profile" })).toBeInTheDocument();
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Reverse path direction for this view" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Full screen" })).not.toBeInTheDocument();
    },
  );
});
