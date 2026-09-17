import { expect, it } from "vitest";
import worker from "../../experiments/better-auth/history-runtime-worker";
import { historyRuntimeFixture } from "../../experiments/better-auth/history-runtime-fixtures";
import { validateLibraryPayload, LIBRARY_REQUEST_MAX_BYTES } from "../../src/lib/libraryLimits";

const env = { PROBE_ENABLED: "history-runtime-only", PROBE_KEY: "synthetic-test-key", PROBE_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString() };
it("requires the disposable key and unexpired probe configuration", async () => {
  for (const bad of [{ ...env, PROBE_KEY: "" }, { ...env, PROBE_EXPIRES_AT: "invalid" }, { ...env, PROBE_EXPIRES_AT: "2020-01-01" }]) {
    expect((await worker.fetch(new Request('https://test/probe/compress', { method: 'POST' }), bad)).status).toBe(404);
  }
});
it("fixtures stay within real request, record and shape limits", () => {
  for (const scenario of ['small', 'large', 'max-record', 'max-batch'] as const) {
    for (const entropy of ['repetitive', 'varied'] as const) {
      const body = historyRuntimeFixture(scenario, entropy);
      expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(LIBRARY_REQUEST_MAX_BYTES);
      expect(() => validateLibraryPayload(JSON.parse(body))).not.toThrow();
    }
  }
});
it("runs the real codec and returns aggregate sizes only", async () => {
  const body = historyRuntimeFixture('large', 'repetitive');
  const request = (path: string) => new Request('https://test' + path, { method:'POST', headers: { authorization: 'Bearer ' + env.PROBE_KEY }, body });
  const baseline = await (await worker.fetch(request('/probe/baseline'), env)).json() as { storedBytes:number };
  const response = await worker.fetch(request('/probe/compress'), env);
  const result = await response.json() as { storedBytes:number; inputBytes:number; records:number };
  expect(result.storedBytes).toBeLessThan(baseline.storedBytes);
  expect(result.records).toBe(1);
  expect(JSON.stringify(result)).not.toContain('syntheticPadding');
});
it("rejects anonymous, oversized and invalid payloads before compression", async () => {
  expect((await worker.fetch(new Request('https://test/probe/compress', { method: 'POST', body: '{}' }), env)).status).toBe(404);
  const request = (body: string) => new Request('https://test/probe/compress', { method:'POST', headers: { authorization: 'Bearer ' + env.PROBE_KEY }, body });
  expect((await worker.fetch(request('x'.repeat(LIBRARY_REQUEST_MAX_BYTES + 1)), env)).status).toBe(413);
  expect((await worker.fetch(request('{'), env)).status).toBe(422);
});

it("maximum fixture survives production save normalization", async () => {
  const { SqliteD1 } = await import("./testSqliteD1");
  const { upsertLibrarySnapshot } = await import("./db");
  for (const entropy of ['repetitive', 'varied'] as const) {
    const db = new SqliteD1();
    try {
      db.db.exec("INSERT INTO users (id, username) VALUES ('probe-owner', 'probe-owner')");
      const payload = JSON.parse(historyRuntimeFixture('max-record', entropy));
      const result = await upsertLibrarySnapshot(
        { DB: db } as unknown as Parameters<typeof upsertLibrarySnapshot>[0],
        { id: 'probe-owner', isAdmin: false, isModerator: false }, payload,
      );
      expect(result.conflicts).toEqual([]);
      expect(result.upsertedSimulations).toBe(1);
    } finally { db.db.close(); }
  }
});
