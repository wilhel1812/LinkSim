// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AuthSignInPopover } from "./AuthSignInPopover";
import { ModalOverlay } from "./ModalOverlay";

const renderPopover = (overrides: Partial<React.ComponentProps<typeof AuthSignInPopover>> = {}) => {
  const trigger = document.createElement("button");
  trigger.getBoundingClientRect = () => new DOMRect(100, 100, 180, 40);
  document.body.append(trigger);
  const triggerRef = createRef<HTMLElement>();
  triggerRef.current = trigger;
  const props = {
    busyMethod: null,
    onClose: vi.fn(),
    onGithub: vi.fn(),
    onPasskey: vi.fn(),
    open: true,
    triggerRef,
    ...overrides,
  } satisfies React.ComponentProps<typeof AuthSignInPopover>;
  return { ...render(<AuthSignInPopover {...props} />), props, trigger };
};

describe("AuthSignInPopover", () => {
  it("explains which method works for a first-time user", async () => {
    const view = renderPopover();
    try {
      const popover = await screen.findByRole("dialog", { name: "Sign in or sign up" });
      expect(popover.closest(".ui-surface-pill")).toHaveClass("auth-sign-in-popover");
      expect(popover.querySelector(".ui-settings-popover-list")).toBeInTheDocument();
      expect(screen.getByText(/Use GitHub to create an account or recover access/i)).toBeInTheDocument();
      expect(screen.getByText(/Use a passkey only if you added one previously/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Use a passkey" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    } finally {
      view.unmount();
      view.trigger.remove();
    }
  });

  it("runs only the explicitly selected sign-in method", async () => {
    const view = renderPopover();
    try {
      await screen.findByRole("dialog", { name: "Sign in or sign up" });
      await userEvent.click(screen.getByRole("button", { name: "Continue with GitHub" }));
      expect(view.props.onGithub).toHaveBeenCalledWith(
        screen.getByLabelText("Anti-bot check"),
      );
      expect(view.props.onPasskey).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      view.trigger.remove();
    }
  });

  it("shows the anti-bot check inside the popover during GitHub sign-in", async () => {
    const view = renderPopover({ busyMethod: "github" });
    try {
      const dialog = await screen.findByRole("dialog", { name: "Sign in or sign up" });
      const challenge = screen.getByLabelText("Anti-bot check");
      expect(dialog).toContainElement(challenge);
      expect(challenge.closest(".auth-sign-in-challenge-row")).toHaveClass("is-active");
      expect(screen.getByRole("button", { name: "Opening GitHub…" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Use a passkey" })).toBeDisabled();
    } finally {
      view.unmount();
      view.trigger.remove();
    }
  });

  it("closes on Escape while idle", async () => {
    const view = renderPopover();
    try {
      await screen.findByRole("dialog", { name: "Sign in or sign up" });
      await userEvent.keyboard("{Escape}");
      expect(view.props.onClose).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      view.trigger.remove();
    }
  });

  it("takes keyboard ownership from a suspended parent modal and restores its trigger", async () => {
    const parentClose = vi.fn();

    function NestedHarness() {
      const [open, setOpen] = useState(false);
      const triggerRef = useRef<HTMLButtonElement | null>(null);
      return (
        <>
          <ModalOverlay aria-label="Import radio preset" onClose={parentClose} suspended={open} tier="raised">
            <div>
              <button ref={triggerRef} onClick={() => setOpen(true)} type="button">Sign in to save</button>
            </div>
          </ModalOverlay>
          <AuthSignInPopover
            busyMethod={null}
            onClose={() => setOpen(false)}
            onGithub={vi.fn()}
            onPasskey={vi.fn()}
            open={open}
            triggerRef={triggerRef}
          />
        </>
      );
    }

    render(<NestedHarness />);
    const trigger = screen.getByRole("button", { name: "Sign in to save" });
    trigger.getBoundingClientRect = () => new DOMRect(100, 100, 180, 40);
    await userEvent.click(trigger);

    const github = await screen.findByRole("button", { name: "Continue with GitHub" });
    expect(screen.getByLabelText("Import radio preset", { selector: '[aria-hidden="true"]' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(github));

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign in or sign up" })).not.toBeInTheDocument());
    expect(parentClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Import radio preset" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
