import { afterEach, expect, it, vi } from "vitest";
import { fetchNotifications } from "./cloudNotifications";
afterEach(() => vi.unstubAllGlobals());
it("shares only overlapping requests for the same identity", async () => {
  let finish!: (value: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
    .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({items: [], unreadCount: 0}))));
  vi.stubGlobal("fetch", fetch);
  const a = fetchNotifications("alice");
  const b = fetchNotifications("alice");
  await fetchNotifications("bob");
  expect(fetch).toHaveBeenCalledTimes(2);
  finish(new Response(JSON.stringify({items: [], unreadCount: 1})));
  expect(await a).toEqual(await b);
  await fetchNotifications("alice");
  expect(fetch).toHaveBeenCalledTimes(3);
});
it("does not cache failed requests", async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(new Response(JSON.stringify({items: [], unreadCount: 0})));
  vi.stubGlobal("fetch", fetch);
  await expect(fetchNotifications("alice")).rejects.toThrow("offline");
  await expect(fetchNotifications("alice")).resolves.toMatchObject({unreadCount: 0});
});
it("aborts a stuck shared request and allows the next poll to recover", async () => {
  vi.useFakeTimers();
  try {
    const fetch=vi.fn().mockImplementationOnce((_url,options)=>new Promise((_resolve,reject)=>{
      options?.signal?.addEventListener("abort",()=>reject(new Error("timed out")));
    })).mockResolvedValue(new Response(JSON.stringify({items:[],unreadCount:0})));
    vi.stubGlobal("fetch",fetch);
    const first=fetchNotifications("timeout-user");
    const rejected=expect(first).rejects.toThrow("timed out");
    expect(fetchNotifications("timeout-user")).toBe(first);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetch.mock.calls[0][1].signal?.aborted).toBe(true);
    await rejected;
    await expect(fetchNotifications("timeout-user")).resolves.toMatchObject({unreadCount:0});
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {vi.useRealTimers();}
});
