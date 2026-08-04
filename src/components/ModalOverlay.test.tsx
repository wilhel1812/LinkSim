// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ModalOverlay } from "./ModalOverlay";

describe("ModalOverlay focus management", () => {
  it("focuses the first control, traps Tab, and restores the trigger focus", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const Harness = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">Open</button>
          {open ? (
            <ModalOverlay
              aria-label="Example modal"
              onClose={() => {
                onClose();
                setOpen(false);
              }}
            >
              <button type="button">First</button>
              <button onClick={() => setOpen(false)} type="button">Last</button>
            </ModalOverlay>
          ) : null}
        </>
      );
    };
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Open" });
    await user.click(trigger);
    expect(await screen.findByRole("button", { name: "First" })).toHaveFocus();

    screen.getByRole("button", { name: "Last" }).focus();
    await user.tab();
    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Last" }));
    expect(trigger).toHaveFocus();
  });

  it("releases focus and Escape handling while suspended", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <>
        <button type="button">Editor control</button>
        <ModalOverlay aria-label="Suspended modal" onClose={onClose} suspended>
          <button type="button">Hidden control</button>
        </ModalOverlay>
      </>,
    );

    const editorControl = screen.getByRole("button", { name: "Editor control" });
    editorControl.focus();
    await user.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
    expect(editorControl).toHaveFocus();
    expect(screen.queryByRole("dialog", { name: "Suspended modal" })).not.toBeInTheDocument();
  });
});
