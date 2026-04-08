import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LIBRARY_FILTER_STATE,
  parsePersistedLibraryFilterState,
  serializeLibraryFilterState,
  type LibraryFilterState,
} from "./libraryFilters";
import {
  effectiveSelection,
  persistLibraryFilterState,
  readLibraryFilterState,
  selectionIsFiltered,
  selectionLabel,
  toggleValue,
} from "./libraryFilterUi";

describe("libraryFilterUi", () => {
  it("treats empty selected values as all values", () => {
    expect(effectiveSelection<string>([], ["owned", "editable"])).toEqual(["owned", "editable"]);
  });

  it("formats selection label as x/y using effective selection", () => {
    expect(selectionLabel<string>([], ["owned", "editable"])).toBe("2/2");
    expect(selectionLabel<string>(["owned"], ["owned", "editable"])).toBe("1/2");
  });

  it("marks filtered only when effective selection is not full set", () => {
    expect(selectionIsFiltered<string>([], ["owned", "editable"])).toBe(false);
    expect(selectionIsFiltered<string>(["owned"], ["owned", "editable"])).toBe(true);
  });

  it("toggles values by removing existing key and adding missing key", () => {
    expect(toggleValue(["owned", "editable"], "owned")).toEqual(["editable"]);
    expect(toggleValue(["owned"], "editable")).toEqual(["owned", "editable"]);
  });

  it("reads persisted filter state and falls back on storage errors", () => {
    const state: LibraryFilterState = {
      searchQuery: "abc",
      roleFilters: ["owned"],
      visibilityFilters: ["private"],
      sourceFilters: ["mqtt"],
      sort: "nameAsc",
    };
    const stored = serializeLibraryFilterState(state);
    const getItem = vi.fn().mockReturnValue(stored);
    vi.stubGlobal("localStorage", { getItem, setItem: vi.fn() });
    expect(readLibraryFilterState("test-key")).toEqual(
      parsePersistedLibraryFilterState(stored, DEFAULT_LIBRARY_FILTER_STATE),
    );

    getItem.mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readLibraryFilterState("test-key")).toEqual(DEFAULT_LIBRARY_FILTER_STATE);
    vi.unstubAllGlobals();
  });

  it("persists filter state with best-effort storage", () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: vi.fn(), setItem });
    const state: LibraryFilterState = {
      searchQuery: "",
      roleFilters: ["owned"],
      visibilityFilters: ["private"],
      sourceFilters: [],
      sort: "nameAsc",
    };
    persistLibraryFilterState("persist-key", state);
    expect(setItem).toHaveBeenCalledWith("persist-key", serializeLibraryFilterState(state));

    setItem.mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => persistLibraryFilterState("persist-key", state)).not.toThrow();
    vi.unstubAllGlobals();
  });
});
