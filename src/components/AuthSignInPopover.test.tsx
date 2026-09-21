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
    onLegacyMigration: vi.fn(),
    onPasskey: vi.fn(),
    open: true,
    triggerRef,
    ...overrides,
  } satisfies React.ComponentProps<typeof AuthSignInPopover>;
  return { ...render(<AuthSignInPopover {...props} />), props, trigger };
};

describe("AuthSignInPopover", () => {
  it("uses compact settings rows and identifies GitHub as the registration path", async () => {
    const view = renderPopover();
    try {
      const popover = await screen.findByRole("dialog", { name: "Sign in or sign up" });
      expect(popover.closest(".ui-surface-pill")).toHaveClass("auth-sign-in-popover");
      expect(popover.querySelector(".ui-settings-popover-list")).toBeInTheDocument();
      expect(screen.queryByText("Sign in or sign up")).not.toBeInTheDocument();
      expect(screen.queryByText("Choose a sign-in method.")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        "New accounts start with GitHub. Used LinkSim before? Move your Cloudflare account first.",
      );
      expect(screen.getByRole("button", { name: "GitHub" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Passkey" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Move existing Cloudflare account" })).toBeInTheDocument();
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
      await userEvent.click(screen.getByRole("button", { name: "GitHub" }));
      expect(view.props.onGithub).toHaveBeenCalledWith(
        screen.getByLabelText("Anti-bot check"),
      );
      expect(view.props.onPasskey).not.toHaveBeenCalled();
      expect(view.props.onLegacyMigration).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      view.trigger.remove();
    }
  });

  it("automatically continues GitHub when an existing-account migration requires it", async () => {
    const onAutoGithub = vi.fn();
    const view = renderPopover({ autoStartGithub: true, onAutoGithub });
    try {
      await waitFor(() => expect(onAutoGithub).toHaveBeenCalledWith(
        screen.getByLabelText("Anti-bot check"),
      ));
      expect(onAutoGithub).toHaveBeenCalledTimes(1);
      view.rerender(<AuthSignInPopover {...view.props} busyMethod="github" />);
      expect(onAutoGithub).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      view.trigger.remove();
    }
  });

  it("starts the explicit legacy migration path without invoking GitHub directly", async () => {
    const view = renderPopover();
    try {
      await screen.findByRole("dialog", { name: "Sign in or sign up" });
      await userEvent.click(screen.getByRole("button", { name: "Move existing Cloudflare account" }));
      expect(view.props.onLegacyMigration).toHaveBeenCalledOnce();
      expect(view.props.onGithub).not.toHaveBeenCalled();
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
      expect(screen.getByRole("button", { name: "Passkey" })).toBeDisabled();
    } finally {
      view.unmount();
      view.trigger.remove();
    }
  });

  it("prepares users for the browser or device prompt while passkey sign-in is active", async () => {
    const view = renderPopover({ busyMethod: "passkey" });
    try {
      const status = await screen.findByRole("status");
      expect(status).toHaveTextContent(
        "Follow your browser or device prompt to use your passkey.",
      );
      expect(status.closest('[aria-busy="true"]')).toBeNull();
      expect(screen.getByRole("button", { name: "Using passkey…" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "GitHub" })).toBeDisabled();
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
            onLegacyMigration={vi.fn()}
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

    const github = await screen.findByRole("button", { name: "GitHub" });
    expect(screen.getByLabelText("Import radio preset", { selector: '[aria-hidden="true"]' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(github));

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sign in or sign up" })).not.toBeInTheDocument());
    expect(parentClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Import radio preset" })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
