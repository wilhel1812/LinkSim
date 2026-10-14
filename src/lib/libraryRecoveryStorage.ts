// Recovery copies use the same browser CacheStorage mechanism as terrain/peak
// caches, with a separate preserved namespace. Synthetic keys are never fetched.
export const LIBRARY_RECOVERY_CACHE_NAME = "linksim-library-recovery-v1";
const marker = JSON.stringify({ storage: "cacheStorage", version: 1 });
const requestFor = (key: string): Request =>
  new Request(`https://library-recovery.linksim.invalid/${encodeURIComponent(key)}`);

export const readLibraryRecoveryStorage = async <T>(key: string): Promise<T | null> => {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  if (raw !== marker) return JSON.parse(raw) as T;
  if (typeof caches === "undefined") {
    if (raw === marker) throw new Error("Library recovery storage is unavailable");
    return null;
  }
  const cache = await caches.open(LIBRARY_RECOVERY_CACHE_NAME);
  const response = await cache.match(requestFor(key));
  if (!response && raw === marker) throw new Error("Library recovery backup is unavailable");
  return response ? await response.json() as T : null;
};

export const writeLibraryRecoveryStorage = async (key: string, value: unknown): Promise<boolean> => {
  try {
    const encoded = JSON.stringify(value);
    try {
      if (localStorage.getItem(key) !== marker) {
        localStorage.setItem(key, encoded);
        return true;
      }
    } catch {
      // A recovery copy may exceed localStorage's smaller quota. Preserve it in
      // CacheStorage before changing any live Library or account keys.
    }
    if (typeof caches === "undefined") return false;
    const cache = await caches.open(LIBRARY_RECOVERY_CACHE_NAME);
    await cache.put(requestFor(key), new Response(encoded, {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    }));
    localStorage.setItem(key, marker);
    return true;
  } catch {
    return false;
  }
};
