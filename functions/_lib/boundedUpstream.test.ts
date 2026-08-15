import { describe, expect, it } from "vitest";
import { readBoundedJsonResponse } from "./boundedUpstream";

describe("bounded upstream JSON", () => {
  it("accepts the exact byte and record boundaries", async () => {
    const body = JSON.stringify([{ id: 1 }]);
    const result = await readBoundedJsonResponse<unknown[]>(new Response(body), {
      maxBytes: new TextEncoder().encode(body).byteLength,
      maxRecords: 1,
    });
    expect(result.value).toEqual([{ id: 1 }]);
    expect(new TextDecoder().decode(result.bytes)).toBe(body);
  });

  it("rejects declared or streamed bytes above the cap and cancels the stream", async () => {
    let declaredCancelled = false;
    const declaredStream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("[]")); },
      cancel() { declaredCancelled = true; },
    });
    await expect(readBoundedJsonResponse(new Response(declaredStream, { headers: { "content-length": "11" } }), { maxBytes: 10, maxRecords: 1 }))
      .rejects.toThrow("size limit");
    expect(declaredCancelled).toBe(true);

    let streamedCancelled = false;
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(11)); },
      cancel() { streamedCancelled = true; },
    });
    await expect(readBoundedJsonResponse(new Response(streamed), { maxBytes: 10, maxRecords: 1 })).rejects.toThrow("size limit");
    expect(streamedCancelled).toBe(true);
  });

  it("rejects malformed JSON, primitive roots, and records above the cap", async () => {
    await expect(readBoundedJsonResponse(new Response("{"), { maxBytes: 10, maxRecords: 1 })).rejects.toThrow("valid JSON");
    await expect(readBoundedJsonResponse(new Response("null"), { maxBytes: 10, maxRecords: 1 })).rejects.toThrow("object or array");
    await expect(readBoundedJsonResponse(new Response("42"), { maxBytes: 10, maxRecords: 1 })).rejects.toThrow("object or array");
    await expect(readBoundedJsonResponse(new Response("[1,2]"), { maxBytes: 10, maxRecords: 1 })).rejects.toThrow("record limit");
  });
});
