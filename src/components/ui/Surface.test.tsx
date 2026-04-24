// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Surface } from "./Surface";

describe("Surface", () => {
  it("renders the shared pill surface with muted and pointer modifiers", () => {
    render(
      <Surface as="button" pointerTail pointerTone="selection" tone="muted" variant="pill">
        Shared surface
      </Surface>,
    );

    const surface = screen.getByRole("button", { name: "Shared surface" });
    expect(surface).toHaveClass("ui-surface-pill");
    expect(surface).toHaveClass("is-muted");
    expect(surface).toHaveClass("has-pointer-tail");
    expect(surface).toHaveClass("is-pointer-selection");
    expect(surface).toHaveAttribute("type", "button");
  });

  it("renders card surfaces without the pill pointer classes by default", () => {
    render(<Surface variant="card">Card surface</Surface>);

    const surface = screen.getByText("Card surface");
    expect(surface).toHaveClass("ui-surface-pill");
    expect(surface).toHaveClass("is-card");
    expect(surface).not.toHaveClass("is-muted");
    expect(surface).not.toHaveClass("has-pointer-tail");
  });
});
