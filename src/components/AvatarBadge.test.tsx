// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AvatarBadge } from "./AvatarBadge";

describe("AvatarBadge", () => {
  it("loads avatar images lazily without referrer data", () => {
    render(<AvatarBadge name="Ada" avatarUrl="/api/avatar/example" imageClassName="avatar" />);
    const image = screen.getByRole("img", { name: "Ada" });
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("decoding", "async");
    expect(image).toHaveAttribute("referrerpolicy", "no-referrer");
  });
});
