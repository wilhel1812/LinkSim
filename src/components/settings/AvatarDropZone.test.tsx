// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { uploadAvatarMock, updateMyProfileMock } = vi.hoisted(() => ({
  uploadAvatarMock: vi.fn(),
  updateMyProfileMock: vi.fn(),
}));
vi.mock("../../lib/cloudUser", () => ({
  uploadAvatar: uploadAvatarMock,
  updateMyProfile: updateMyProfileMock,
}));

import { AvatarDropZone } from "./AvatarDropZone";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:test"),
    revokeObjectURL: vi.fn(),
  });
});

describe("AvatarDropZone HEIC selection", () => {
  it("offers HEIC/HEIF selection and reports browser decode failure through the existing error UI", async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    }
    vi.stubGlobal("Image", FailingImage);
    const view = render(<AvatarDropZone name="Ada" avatarUrl="" onUpdated={vi.fn()} />);
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toBe("image/*,.heic,.heif");
    expect(screen.getByText(/HEIC/)).toBeInTheDocument();

    fireEvent.change(input, { target: { files: [new File(["heic"], "photo.heic", { type: "image/heic" })] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to decode image.");
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalled());
    expect(uploadAvatarMock).not.toHaveBeenCalled();
  });
});
