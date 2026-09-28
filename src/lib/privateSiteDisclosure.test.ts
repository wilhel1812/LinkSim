import { describe, expect, it } from "vitest";
import { getReferencedPrivateSiteIds } from "./privateSiteDisclosure";

describe("getReferencedPrivateSiteIds", () => {
  it("filters unreferenced and non-private entries, deduplicates references, and sorts ids", () => {
    expect(getReferencedPrivateSiteIds(
      {
        snapshot: {
          sites: [
            { libraryEntryId: "private-z" },
            { libraryEntryId: "shared-a" },
            { libraryEntryId: "private-b" },
            { libraryEntryId: "private-z" },
            { libraryEntryId: "missing" },
            { libraryEntryId: "" },
          ],
        },
      },
      [
        { id: "private-z", visibility: "private" },
        { id: "shared-a", visibility: "shared" },
        { id: "private-b", visibility: "private" },
        { id: "unreferenced", visibility: "private" },
      ],
    )).toEqual(["private-b", "private-z"]);
  });

  it("normalizes legacy public visibility values and defaults unknown values to private", () => {
    expect(getReferencedPrivateSiteIds(
      {
        snapshot: {
          sites: [
            { libraryEntryId: "missing-visibility" },
            { libraryEntryId: "legacy-visibility" },
            { libraryEntryId: "public-site" },
            { libraryEntryId: "legacy-public-read" },
            { libraryEntryId: "legacy-public-write" },
          ],
        },
      },
      [
        { id: "missing-visibility" },
        { id: "legacy-visibility", visibility: "team" },
        { id: "public-site", visibility: "public" },
        { id: "legacy-public-read", visibility: "public_read" },
        { id: "legacy-public-write", visibility: "public_write" },
      ],
    )).toEqual(["legacy-visibility", "missing-visibility"]);
  });
});
