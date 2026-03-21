export type LibraryFilterRole = "owned" | "collaborator" | "editable" | "viewOnly";
export type LibraryFilterVisibility = "private" | "sharedPublic";
export type LibraryFilterSort = "nameAsc";

export interface LibraryFilterState {
  searchQuery: string;
  roleFilters: LibraryFilterRole[];
  visibilityFilters: LibraryFilterVisibility[];
  sort: LibraryFilterSort;
}

export interface FilterableLibraryItem {
  name: string;
  ownerUserId?: string;
  effectiveRole?: "owner" | "admin" | "editor" | "viewer";
  visibility?: "private" | "public" | "shared" | "public_read" | "public_write";
}

type PersistedLibraryFilterStateV1 = {
  version: 1;
  searchQuery: string;
  roleFilters: LibraryFilterRole[];
  visibilityFilters: LibraryFilterVisibility[];
  sort: LibraryFilterSort;
};

const ROLE_FILTERS: LibraryFilterRole[] = ["owned", "collaborator", "editable", "viewOnly"];
const VISIBILITY_FILTERS: LibraryFilterVisibility[] = ["private", "sharedPublic"];

export const DEFAULT_LIBRARY_FILTER_STATE: LibraryFilterState = {
  searchQuery: "",
  roleFilters: ["owned", "collaborator"],
  visibilityFilters: [],
  sort: "nameAsc",
};

const normalizeVisibility = (value: FilterableLibraryItem["visibility"]): "private" | "public" | "shared" => {
  if (value === "public" || value === "public_read") return "public";
  if (value === "shared" || value === "public_write") return "shared";
  return "private";
};

const dedupeInOrder = <T extends string>(values: T[]): T[] => {
  const seen = new Set<T>();
  const deduped: T[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    deduped.push(value);
  }
  return deduped;
};

const sanitizeRoleFilters = (value: unknown): LibraryFilterRole[] => {
  if (!Array.isArray(value)) return [];
  const roleSet = new Set(ROLE_FILTERS);
  return dedupeInOrder(value.filter((entry): entry is LibraryFilterRole => roleSet.has(entry as LibraryFilterRole)));
};

const sanitizeVisibilityFilters = (value: unknown): LibraryFilterVisibility[] => {
  if (!Array.isArray(value)) return [];
  const visibilitySet = new Set(VISIBILITY_FILTERS);
  return dedupeInOrder(
    value.filter((entry): entry is LibraryFilterVisibility => visibilitySet.has(entry as LibraryFilterVisibility)),
  );
};

const sanitizeSearchQuery = (value: unknown): string => (typeof value === "string" ? value : "");

const sanitizeSort = (value: unknown): LibraryFilterSort => (value === "nameAsc" ? "nameAsc" : "nameAsc");

export const parsePersistedLibraryFilterState = (
  raw: string | null,
  fallback: LibraryFilterState = DEFAULT_LIBRARY_FILTER_STATE,
): LibraryFilterState => {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedLibraryFilterStateV1>;
    if (!parsed || typeof parsed !== "object") return fallback;
    if (parsed.version !== 1) return fallback;
    return {
      searchQuery: sanitizeSearchQuery(parsed.searchQuery),
      roleFilters: sanitizeRoleFilters(parsed.roleFilters),
      visibilityFilters: sanitizeVisibilityFilters(parsed.visibilityFilters),
      sort: sanitizeSort(parsed.sort),
    };
  } catch {
    return fallback;
  }
};

export const serializeLibraryFilterState = (state: LibraryFilterState): string =>
  JSON.stringify({
    version: 1,
    searchQuery: state.searchQuery,
    roleFilters: sanitizeRoleFilters(state.roleFilters),
    visibilityFilters: sanitizeVisibilityFilters(state.visibilityFilters),
    sort: sanitizeSort(state.sort),
  } satisfies PersistedLibraryFilterStateV1);

const isEditable = (item: FilterableLibraryItem, currentUserId: string | null): boolean => {
  if (!currentUserId) return false;
  if (item.ownerUserId === currentUserId) return true;
  return item.effectiveRole === "owner" || item.effectiveRole === "admin" || item.effectiveRole === "editor";
};

const isCollaborator = (item: FilterableLibraryItem, currentUserId: string | null): boolean => {
  if (!currentUserId) return false;
  if (item.ownerUserId === currentUserId) return false;
  return item.effectiveRole === "admin" || item.effectiveRole === "editor";
};

const isViewOnly = (item: FilterableLibraryItem, currentUserId: string | null): boolean => {
  if (!currentUserId) return true;
  return !isEditable(item, currentUserId);
};

const roleFilterMatch = (
  item: FilterableLibraryItem,
  roleFilters: LibraryFilterRole[],
  currentUserId: string | null,
): boolean => {
  if (!roleFilters.length) return true;
  return roleFilters.some((role) => {
    if (role === "owned") return Boolean(currentUserId && item.ownerUserId === currentUserId);
    if (role === "collaborator") return isCollaborator(item, currentUserId);
    if (role === "editable") return isEditable(item, currentUserId);
    return isViewOnly(item, currentUserId);
  });
};

const visibilityFilterMatch = (item: FilterableLibraryItem, visibilityFilters: LibraryFilterVisibility[]): boolean => {
  if (!visibilityFilters.length) return true;
  const visibility = normalizeVisibility(item.visibility);
  return visibilityFilters.some((filter) => {
    if (filter === "private") return visibility === "private";
    return visibility === "public" || visibility === "shared";
  });
};

export const filterAndSortLibraryItems = <T extends FilterableLibraryItem>(
  items: T[],
  filters: LibraryFilterState,
  currentUserId: string | null,
  searchTextForItem?: (item: T) => string,
): T[] => {
  const query = filters.searchQuery.trim().toLowerCase();
  const searched = query
    ? items.filter((item) => {
        const base = searchTextForItem ? searchTextForItem(item) : item.name;
        return base.toLowerCase().includes(query);
      })
    : items;

  const filtered = searched.filter(
    (item) =>
      roleFilterMatch(item, filters.roleFilters, currentUserId) &&
      visibilityFilterMatch(item, filters.visibilityFilters),
  );

  if (filters.sort === "nameAsc") {
    return filtered.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  return filtered;
};
