// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchPublicSiteNoticeMock } = vi.hoisted(() => ({ fetchPublicSiteNoticeMock: vi.fn() }));
vi.mock("../lib/cloudSiteNotice", () => ({ fetchPublicSiteNotice: fetchPublicSiteNoticeMock }));

const storage = new Map<string, string>();
const localStorageMock = {
  clear: () => storage.clear(),
  getItem: (key: string) => storage.get(key) ?? null,
  removeItem: (key: string) => storage.delete(key),
  setItem: (key: string, value: string) => storage.set(key, value),
};
vi.stubGlobal("localStorage", localStorageMock);
Object.defineProperty(window, "localStorage", { configurable: true, value: localStorageMock });

import { SITE_NOTICE_UPDATED_EVENT } from "../lib/siteNotice";
import { SiteNoticeBanner, SiteNoticeSurface } from "./SiteNoticeBanner";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("SiteNoticeBanner", () => {
  it("does not announce admin preview edits as live status changes", () => {
    render(<SiteNoticeSurface
      notice={{ tone: "incident", message: "Preview text", dismissible: false }}
      preview
    />);

    const preview = screen.getByLabelText("Notice preview");
    expect(preview).toHaveAttribute("aria-live", "off");
    expect(preview).not.toHaveAttribute("role", "alert");
    expect(preview).not.toHaveAttribute("role", "status");
  });

  it("renders and dismisses a dismissible public notice", async () => {
    fetchPublicSiteNoticeMock.mockResolvedValue({
      tone: "information",
      message: "Scheduled maintenance tonight.",
      dismissible: true,
      revision: 8,
      updatedAt: "2026-08-20T10:00:00.000Z",
      expiresAt: null,
    });
    render(<SiteNoticeBanner />);

    expect(await screen.findByRole("status")).toHaveTextContent("Scheduled maintenance tonight.");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss site notice" }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(localStorage.getItem("linksim:site-notice-dismissed:v1:8")).toBe("1");
  });

  it("keeps a non-dismissible registration notice visible", async () => {
    fetchPublicSiteNoticeMock.mockResolvedValue({
      tone: "warning",
      message: "LinkSim is temporarily not accepting new user registrations.",
      dismissible: false,
      revision: 9,
      updatedAt: "2026-08-20T10:00:00.000Z",
      expiresAt: null,
    });
    render(<SiteNoticeBanner />);

    expect(await screen.findByRole("status")).toHaveTextContent("temporarily not accepting");
    expect(screen.queryByRole("button", { name: "Dismiss site notice" })).not.toBeInTheDocument();
  });

  it("keeps the app quiet when status loading fails", async () => {
    fetchPublicSiteNoticeMock.mockRejectedValue(new Error("offline"));
    render(<SiteNoticeBanner />);
    await waitFor(() => expect(fetchPublicSiteNoticeMock).toHaveBeenCalled());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("ignores an older refresh that completes after a newer notice", async () => {
    let resolveFirst: (notice: unknown) => void = () => undefined;
    let resolveSecond: (notice: unknown) => void = () => undefined;
    fetchPublicSiteNoticeMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    render(<SiteNoticeBanner />);
    await waitFor(() => expect(fetchPublicSiteNoticeMock).toHaveBeenCalledTimes(1));

    window.dispatchEvent(new Event(SITE_NOTICE_UPDATED_EVENT));
    await waitFor(() => expect(fetchPublicSiteNoticeMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveSecond({
        tone: "warning",
        message: "New notice",
        dismissible: false,
        revision: 12,
        updatedAt: "2026-08-20T12:00:00.000Z",
        expiresAt: null,
      });
    });
    expect(await screen.findByRole("status")).toHaveTextContent("New notice");

    await act(async () => {
      resolveFirst({
        tone: "information",
        message: "Old notice",
        dismissible: false,
        revision: 11,
        updatedAt: "2026-08-20T11:00:00.000Z",
        expiresAt: null,
      });
    });
    expect(screen.getByRole("status")).toHaveTextContent("New notice");
    expect(screen.queryByText("Old notice")).not.toBeInTheDocument();
  });
});
