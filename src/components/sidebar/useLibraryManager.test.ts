import { describe, expect, it } from "vitest";
import { toggleLibraryIdSelection } from "./useLibraryManager";

describe("toggleLibraryIdSelection", () => {
  it("adds an id when not selected", () => {
    const next = toggleLibraryIdSelection(new Set(["a"]), "b");
    expect(Array.from(next).sort()).toEqual(["a", "b"]);
  });

  it("removes an id when already selected", () => {
    const next = toggleLibraryIdSelection(new Set(["a", "b"]), "a");
    expect(Array.from(next).sort()).toEqual(["b"]);
  });
});
