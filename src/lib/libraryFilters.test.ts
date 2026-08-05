import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIBRARY_FILTER_STATE,
  filterAndSortLibraryItems,
  parsePersistedLibraryFilterState,
  serializeLibraryFilterState,
  type FilterableLibraryItem,
  type LibraryFilterState,
} from "./libraryFilters";

type MockItem = FilterableLibraryItem & { id: string; searchText?: string; createdAt?: string; updatedAt?: string };

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
      sourceFilters: [],
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
      sourceFilters: [],
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
      sourceFilters: [],
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
      sourceFilters: [],
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
      sourceFilters: [],
      sort: "nameAsc",
    };
    const parsed = parsePersistedLibraryFilterState(serializeLibraryFilterState(state));
    expect(parsed).toEqual({
      searchQuery: "foo",
      roleFilters: ["owned", "editable"],
      visibilityFilters: ["private", "sharedPublic"],
      sourceFilters: [],
      sort: "nameAsc",
    });
  });

  it("supports source filters for site lists", () => {
    const sourceItems: Array<MockItem & { sourceType: string }> = [
      { id: "m", name: "MQTT Hill", sourceType: "mqtt-feed", ownerUserId: "u1", effectiveRole: "owner" },
      { id: "n", name: "Manual Peak", sourceType: "manual", ownerUserId: "u1", effectiveRole: "owner" },
    ];
    const filters: LibraryFilterState = {
      searchQuery: "",
      roleFilters: ["owned"],
      visibilityFilters: [],
      sourceFilters: ["mqtt"],
      sort: "nameAsc",
    };
    const result = filterAndSortLibraryItems(
      sourceItems,
      filters,
      "u1",
      (item) => item.name,
      (item, source) => (source === "mqtt" ? item.sourceType === "mqtt-feed" : item.sourceType !== "mqtt-feed"),
    );
    expect(ids(result)).toEqual(["m"]);
  });

  it("sorts recent items from newest to oldest using their available Library timestamp", () => {
    const filters: LibraryFilterState = {
      ...DEFAULT_LIBRARY_FILTER_STATE,
      roleFilters: [],
      sort: "recentDesc",
    };
    const recentItems: MockItem[] = [
      { id: "older", name: "Older", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "newer", name: "Newer", updatedAt: "2026-02-01T00:00:00.000Z" },
      { id: "undated", name: "Undated" },
    ];

    expect(ids(filterAndSortLibraryItems(recentItems, filters, "u1"))).toEqual([
      "newer",
      "older",
      "undated",
    ]);
  });

  it("migrates version 1 persisted filters to the name sort", () => {
    expect(
      parsePersistedLibraryFilterState(
        JSON.stringify({
          version: 1,
          searchQuery: "ridge",
          roleFilters: ["owned"],
          visibilityFilters: ["private"],
          sourceFilters: ["manual"],
          sort: "nameAsc",
        }),
      ),
    ).toEqual({
      searchQuery: "ridge",
      roleFilters: ["owned"],
      visibilityFilters: ["private"],
      sourceFilters: ["manual"],
      sort: "nameAsc",
    });
  });

  it("falls back for malformed persisted state", () => {
    const parsed = parsePersistedLibraryFilterState("{oops");
    expect(parsed).toEqual(DEFAULT_LIBRARY_FILTER_STATE);
  });
});
