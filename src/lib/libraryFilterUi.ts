import {
  DEFAULT_LIBRARY_FILTER_STATE,
  parsePersistedLibraryFilterState,
  serializeLibraryFilterState,
  type LibraryFilterState,
} from "./libraryFilters";

export const readLibraryFilterState = (key: string): LibraryFilterState => {
  try {
    return parsePersistedLibraryFilterState(localStorage.getItem(key), DEFAULT_LIBRARY_FILTER_STATE);
  } catch {
    return DEFAULT_LIBRARY_FILTER_STATE;
  }
};

export const persistLibraryFilterState = (key: string, state: LibraryFilterState): void => {
  try {
    localStorage.setItem(key, serializeLibraryFilterState(state));
  } catch {
    // Best effort only.
  }
};

export const effectiveSelection = <T extends string>(selected: T[], allValues: T[]): T[] =>
  selected.length ? selected : allValues;

export const selectionLabel = <T extends string>(selected: T[], allValues: T[]): string => {
  const effective = effectiveSelection(selected, allValues);
  return `${effective.length}/${allValues.length}`;
};

export const selectionIsFiltered = <T extends string>(selected: T[], allValues: T[]): boolean => {
  const effective = effectiveSelection(selected, allValues);
  return effective.length !== allValues.length;
};

export const toggleValue = <T extends string>(values: T[], key: T): T[] =>
  values.includes(key) ? values.filter((value) => value !== key) : [...values, key];
