// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsernameSetupModal } from "./UsernameSetupModal";

const { updateMyProfileMock } = vi.hoisted(() => ({
  updateMyProfileMock: vi.fn(),
}));

vi.mock("../lib/cloudUser", () => ({
  updateMyProfile: updateMyProfileMock,
}));

describe("UsernameSetupModal", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    updateMyProfileMock.mockResolvedValue({ id: "u1", username: "Ranger", needsUsername: false });
  });

  it("starts with an empty username field", () => {
    render(<UsernameSetupModal onComplete={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: /^username$/i })).toHaveValue("");
  });

  it("requires a username before continuing", async () => {
    render(<UsernameSetupModal onComplete={vi.fn()} />);

    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: /^username$/i }), "Ranger");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(updateMyProfileMock).toHaveBeenCalledWith({ username: "Ranger" });
  });

  it("calls onComplete after username save", async () => {
    const onComplete = vi.fn();
    render(<UsernameSetupModal onComplete={onComplete} />);

    await userEvent.type(screen.getByRole("textbox", { name: /^username$/i }), "Ranger");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onComplete).toHaveBeenCalledWith({ id: "u1", username: "Ranger", needsUsername: false });
  });
});
