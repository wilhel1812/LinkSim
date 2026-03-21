import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_FILTER_STATE,
  filterAndSortLibraryItems,
  parsePersistedLibraryFilterState,
  serializeLibraryFilterState,
  type FilterableLibraryItem,
  type LibraryFilterState,
} from "./libraryFilters";

type MockItem = FilterableLibraryItem & { id: string; searchText?: string };

const items: MockItem[] = [
  { id: "a", name: "Alpha", ownerUserId: "u1", effectiveRole: "owner", visibility: "private" },
  { id: "b", name: "Bravo", ownerUserId: "u2", effectiveRole: "editor", visibility: "shared" },
  { id: "c", name: "Charlie", ownerUserId: "u3", effectiveRole: "viewer", visibility: "public" },
  { id: "d", name: "Delta", ownerUserId: "u4", effectiveRole: "viewer", visibility: "private" },
];

const ids = (result: MockItem[]): string[] => result.map((item) => item.id);

describe("libraryFilters", () => {
  it("uses owned+collaborator default", () => {
    const result = filterAndSortLibraryItems(items, DEFAULT_LIBRARY_FILTER_STATE, "u1");
    expect(ids(result)).toEqual(["a", "b"]);
  });

  it("supports visibility and role group intersection", () => {
    const filters: LibraryFilterState = {
      searchQuery: "",
      roleFilters: ["editable"],
      visibilityFilters: ["sharedPublic"],
      sort: "nameAsc",
    };
    const result = filterAndSortLibraryItems(items, filters, "u1");
    expect(ids(result)).toEqual(["b"]);
  });

  it("supports private + owned", () => {
    const filters: LibraryFilterState = {
      searchQuery: "",
      roleFilters: ["owned"],
      visibilityFilters: ["private"],
      sort: "nameAsc",
    };
    const result = filterAndSortLibraryItems(items, filters, "u1");
    expect(ids(result)).toEqual(["a"]);
  });

  it("treats signed-out users as view-only when that filter is selected", () => {
    const filters: LibraryFilterState = {
      searchQuery: "",
      roleFilters: ["viewOnly"],
      visibilityFilters: [],
      sort: "nameAsc",
    };
    const result = filterAndSortLibraryItems(items, filters, null);
    expect(ids(result)).toEqual(["a", "b", "c", "d"]);
  });

  it("supports custom search text", () => {
    const withSearchText = items.map((item) => ({ ...item, searchText: `${item.name} ${item.id}` }));
    const filters: LibraryFilterState = {
      searchQuery: " c",
      roleFilters: [],
      visibilityFilters: [],
      sort: "nameAsc",
    };
    const result = filterAndSortLibraryItems(withSearchText, filters, "u1", (item) => item.searchText ?? item.name);
    expect(ids(result)).toEqual(["c"]);
  });

  it("round-trips serialized filter state", () => {
    const state: LibraryFilterState = {
      searchQuery: "foo",
      roleFilters: ["owned", "owned", "editable"],
      visibilityFilters: ["private", "sharedPublic", "private"],
      sort: "nameAsc",
    };
    const parsed = parsePersistedLibraryFilterState(serializeLibraryFilterState(state));
    expect(parsed).toEqual({
      searchQuery: "foo",
      roleFilters: ["owned", "editable"],
      visibilityFilters: ["private", "sharedPublic"],
      sort: "nameAsc",
    });
  });

  it("falls back for malformed persisted state", () => {
    const parsed = parsePersistedLibraryFilterState("{oops");
    expect(parsed).toEqual(DEFAULT_LIBRARY_FILTER_STATE);
  });
});
