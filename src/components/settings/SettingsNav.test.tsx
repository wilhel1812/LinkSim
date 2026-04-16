// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SettingsNav, settingsNavIcons } from "./SettingsNav";
import type { SettingsNavItem } from "./SettingsNav";

const items: SettingsNavItem[] = [
  { id: "profile", label: "Profile", description: "Name, email, avatar", icon: settingsNavIcons.profile },
  { id: "preferences", label: "Preferences", description: "Theme, defaults", icon: settingsNavIcons.preferences },
  { id: "admin", label: "Admin", description: "Users, audit", icon: settingsNavIcons.admin },
];

describe("SettingsNav", () => {
  it("renders one button per nav item", () => {
    render(
      <SettingsNav items={items} activeSection="profile" onSelect={vi.fn()} layout="sidebar" />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: /Profile/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preferences/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Admin/i })).toBeInTheDocument();
  });

  it("marks only the active item with aria-current", () => {
    render(
      <SettingsNav items={items} activeSection="preferences" onSelect={vi.fn()} layout="sidebar" />,
    );
    expect(screen.getByRole("button", { name: /Preferences/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: /Profile/i })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: /Admin/i })).not.toHaveAttribute("aria-current");
  });

  it("calls onSelect with the clicked section id", async () => {
    const onSelect = vi.fn();
    render(
      <SettingsNav items={items} activeSection="profile" onSelect={onSelect} layout="sidebar" />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Admin/i }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith("admin");
  });

  it("shows item descriptions in list layout", () => {
    render(
      <SettingsNav items={items} activeSection="profile" onSelect={vi.fn()} layout="list" />,
    );
    expect(screen.getByText("Name, email, avatar")).toBeInTheDocument();
    expect(screen.getByText("Theme, defaults")).toBeInTheDocument();
  });

  it("hides item descriptions in sidebar layout", () => {
    render(
      <SettingsNav items={items} activeSection="profile" onSelect={vi.fn()} layout="sidebar" />,
    );
    expect(screen.queryByText("Name, email, avatar")).not.toBeInTheDocument();
  });
});
