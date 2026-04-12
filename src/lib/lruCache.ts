export type LruCache<T> = {
  get: (key: string) => T | undefined;
  set: (key: string, value: T) => void;
  clear: () => void;
  size: () => number;
};

export const createLruCache = <T>(capacity: number): LruCache<T> => {
  const maxEntries = Math.max(1, Math.floor(capacity));
  const store = new Map<string, T>();

  return {
    get: (key) => {
      const value = store.get(key);
      if (value === undefined) return undefined;
      store.delete(key);
      store.set(key, value);
      return value;
    },
    set: (key, value) => {
      if (store.has(key)) {
        store.delete(key);
      }
      store.set(key, value);
      while (store.size > maxEntries) {
        const oldest = store.keys().next().value;
        if (typeof oldest !== "string") break;
        store.delete(oldest);
      }
    },
    clear: () => {
      store.clear();
    },
    size: () => store.size,
  };
};
