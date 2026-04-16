// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AutoSaveField } from "./AutoSaveField";

describe("AutoSaveField", () => {
  it("renders the label and input", () => {
    render(<AutoSaveField id="test" label="Username" value="alice" onSave={vi.fn()} />);
    expect(screen.getByLabelText("Username")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("alice");
  });

  it("does not call onSave when blurred without changing the value", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AutoSaveField id="test" label="Username" value="alice" onSave={onSave} />);
    const input = screen.getByRole("textbox");
    await userEvent.click(input);
    await userEvent.tab(); // blur
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onSave with the updated value after the user edits and blurs", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<AutoSaveField id="test" label="Username" value="alice" onSave={onSave} />);
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "bob");
    await userEvent.tab(); // blur
    expect(onSave).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledWith("bob");
  });

  it("shows a validation error and does not call onSave when validate returns a message", async () => {
    const onSave = vi.fn();
    const validate = (v: string) => (v.trim() ? null : "A name is required.");
    render(
      <AutoSaveField id="test" label="Username" value="alice" onSave={onSave} validate={validate} />,
    );
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.tab(); // blur with empty value
    expect(await screen.findByRole("alert")).toHaveTextContent("A name is required.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the save-error message when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Server error"));
    render(<AutoSaveField id="test" label="Bio" value="hello" onSave={onSave} />);
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "updated bio");
    await userEvent.tab();
    expect(await screen.findByRole("alert")).toHaveTextContent("Server error");
  });
});
