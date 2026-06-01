// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FloatingPopover } from "./FloatingPopover";

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
};

function Harness({ estimatedWidth }: { estimatedWidth: number }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <>
      <button ref={triggerRef} onClick={() => setOpen(true)} type="button">
        Open
      </button>
      <FloatingPopover
        estimatedWidth={estimatedWidth}
        onClose={() => setOpen(false)}
        open={open}
        triggerRef={triggerRef}
      >
        <div>Popover content</div>
      </FloatingPopover>
    </>
  );
}

describe("FloatingPopover", () => {
  afterEach(() => {
    setViewportWidth(1024);
  });

  it("keeps a wide trigger popover within the viewport near the right edge", async () => {
    setViewportWidth(500);
    render(<Harness estimatedWidth={420} />);
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.getBoundingClientRect = () => new DOMRect(460, 200, 32, 32);

    await userEvent.click(trigger);

    await waitFor(() => {
      expect(document.querySelector(".ui-action-popover")).toHaveStyle({ left: "282px" });
    });
  });

  it("centers the anchor when the viewport is narrower than the requested width", async () => {
    setViewportWidth(360);
    render(<Harness estimatedWidth={420} />);
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.getBoundingClientRect = () => new DOMRect(320, 200, 32, 32);

    await userEvent.click(trigger);

    await waitFor(() => {
      expect(document.querySelector(".ui-action-popover")).toHaveStyle({ left: "180px" });
    });
  });
});
