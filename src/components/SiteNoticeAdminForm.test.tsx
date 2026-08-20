// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  fetchAdminSiteNoticeMock,
  publishAdminSiteNoticeMock,
  clearAdminSiteNoticeMock,
} = vi.hoisted(() => ({
  fetchAdminSiteNoticeMock: vi.fn(),
  publishAdminSiteNoticeMock: vi.fn(),
  clearAdminSiteNoticeMock: vi.fn(),
}));

vi.mock("../lib/cloudSiteNotice", () => ({
  fetchAdminSiteNotice: fetchAdminSiteNoticeMock,
  publishAdminSiteNotice: publishAdminSiteNoticeMock,
  clearAdminSiteNotice: clearAdminSiteNoticeMock,
}));

import { SiteNoticeAdminForm } from "./SiteNoticeAdminForm";

beforeEach(() => {
  vi.clearAllMocks();
  fetchAdminSiteNoticeMock.mockResolvedValue({
    active: true,
    tone: "warning",
    message: "Old notice",
    dismissible: false,
    startsAt: null,
    expiresAt: null,
    revision: 1,
    updatedAt: "2026-08-20T09:00:00.000Z",
    updatedBy: "admin-0",
  });
  publishAdminSiteNoticeMock.mockResolvedValue({
    active: true,
    tone: "incident",
    message: "LinkSim is experiencing trouble with terrain data.",
    dismissible: false,
    startsAt: null,
    expiresAt: null,
    revision: 2,
    updatedAt: "2026-08-20T10:00:00.000Z",
    updatedBy: "admin-1",
  });
  clearAdminSiteNoticeMock.mockResolvedValue(null);
});

describe("SiteNoticeAdminForm", () => {
  it("previews and publishes an updated notice", async () => {
    render(<SiteNoticeAdminForm />);
    const message = await screen.findByLabelText("Notice message");
    await userEvent.clear(message);
    await userEvent.type(message, "LinkSim is experiencing trouble with terrain data.");
    await userEvent.selectOptions(screen.getByLabelText("Notice tone"), "incident");

    expect(screen.getByLabelText("Notice preview")).toHaveTextContent("trouble with terrain data");
    await userEvent.click(screen.getByRole("button", { name: "Publish notice" }));

    await waitFor(() => expect(publishAdminSiteNoticeMock).toHaveBeenCalledWith({
      active: true,
      tone: "incident",
      message: "LinkSim is experiencing trouble with terrain data.",
      dismissible: false,
      startsAt: null,
      expiresAt: null,
    }));
    expect(await screen.findByText("Site notice published.")).toBeInTheDocument();
  });

  it("removes the active notice after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SiteNoticeAdminForm />);
    await screen.findByDisplayValue("Old notice");
    await userEvent.click(screen.getByRole("button", { name: "Remove notice" }));

    await waitFor(() => expect(clearAdminSiteNoticeMock).toHaveBeenCalledOnce());
    expect(await screen.findByText("Site notice removed.")).toBeInTheDocument();
  });
});
