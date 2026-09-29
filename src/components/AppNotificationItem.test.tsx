// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppNotificationItem } from "./AppNotificationItem";

describe("AppNotificationItem", () => {
  let measuredHeight = 16;

  beforeEach(() => {
    measuredHeight = 16;
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      disconnect() {}
    });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ lineHeight: "16px" } as CSSStyleDeclaration);
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => measuredHeight);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses pill styling for one line and the wrapped radius for multiline static content", async () => {
    const message = `Imported preset: ${"unbroken".repeat(10)}`;
    render(
      <AppNotificationItem static tone="warning">
        {message}
      </AppNotificationItem>,
    );

    const notice = screen.getByRole("status");
    expect(notice).not.toHaveClass("app-notification-item-wrapped");
    expect(screen.queryByRole("button", { name: "Dismiss notification" })).toBeNull();

    measuredHeight = 32;
    act(() => window.dispatchEvent(new Event("resize")));
    await waitFor(() => expect(notice).toHaveClass("app-notification-item-wrapped"));

    measuredHeight = 16;
    act(() => window.dispatchEvent(new Event("resize")));
    await waitFor(() => expect(notice).not.toHaveClass("app-notification-item-wrapped"));
  });
});
