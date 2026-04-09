import { describe, expect, it } from "vitest";
import { createLruCache } from "./lruCache";

describe("createLruCache", () => {
  it("evicts least recently used entry when capacity is exceeded", () => {
    const cache = createLruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);

    cache.set("c", 3);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("updates recency when setting an existing key", () => {
    const cache = createLruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 11);
    cache.set("c", 3);

    expect(cache.get("a")).toBe(11);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("clear removes all entries", () => {
    const cache = createLruCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.size()).toBe(2);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });
});
