// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { InfoTip } from "./InfoTip";

const TIP_TEXT = "Helpful context";

describe("InfoTip", () => {
  it("opens on an initially unfocused pointer click and closes on the next click", async () => {
    const user = userEvent.setup();
    render(<InfoTip text={TIP_TEXT} />);
    const trigger = screen.getByRole("button", { name: TIP_TEXT });

    await user.click(trigger);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent(TIP_TEXT);
    expect(trigger).toHaveAttribute("aria-describedby", tooltip.id);

    await user.unhover(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent(TIP_TEXT);

    await user.click(trigger);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute("aria-describedby");
  });

  it("opens and closes through touch pointer activation", async () => {
    const user = userEvent.setup();
    render(<InfoTip text={TIP_TEXT} />);
    const trigger = screen.getByRole("button", { name: TIP_TEXT });

    await user.pointer([{ keys: "[TouchA>]", target: trigger }, { keys: "[/TouchA]", target: trigger }]);
    expect(screen.getByRole("tooltip")).toHaveTextContent(TIP_TEXT);

    await user.pointer([{ keys: "[TouchA>]", target: trigger }, { keys: "[/TouchA]", target: trigger }]);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on keyboard focus and closes on blur", async () => {
    const user = userEvent.setup();
    render(<><InfoTip text={TIP_TEXT} /><button type="button">Next</button></>);

    await user.tab();
    expect(screen.getByRole("tooltip")).toHaveTextContent(TIP_TEXT);

    await user.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on hover and closes when the pointer leaves", async () => {
    const user = userEvent.setup();
    render(<InfoTip text={TIP_TEXT} />);
    const trigger = screen.getByRole("button", { name: TIP_TEXT });

    await user.hover(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent(TIP_TEXT);

    await user.unhover(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
