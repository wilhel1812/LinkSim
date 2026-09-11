import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { executeVerifiedIdentityEnsure, fetchLibraryForUser } from "./db";
import { SqliteD1 } from "./testSqliteD1";

type Query = { sql: string; values: unknown[] };

// Count SQLite VM instructions, not elapsed time. Python's standard-library SQLite
// exposes the progress hook missing from node:sqlite; no third-party package needed.
const measure = (db: SqliteD1, queries: Query[], label?: string) => {
  const schema = db.db.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")
    .all().map((row) => row.sql);
  const tables = db.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all().map(({ name }) => ({ name, rows: db.db.prepare(`SELECT * FROM "${name}"`).all() }));
  const fixtureData = { schema, tables, queries: queries.map(({ sql, values }) => ({ sql, values })) };
  const result = spawnSync("python3", ["-c", `
import json, sqlite3, sys
fixture = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
for sql in fixture['schema']: db.execute(sql)
for table in fixture['tables']:
    for row in table['rows']:
        db.execute('INSERT INTO "' + table['name'] + '" VALUES (' + ','.join('?' for _ in row) + ')', list(row.values()))
db.commit()
steps = 0
def progress():
    global steps
    steps += 100
    return 0
db.set_progress_handler(progress, 100)
results = []
for query in fixture['queries']:
    results.append(db.execute(query['sql'], query['values']).fetchall())
print(json.dumps({'steps': steps, 'results': results}))
`], { input: JSON.stringify(fixtureData), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`SQLite cost measurement failed: ${result.error ?? result.stderr}`);
  if (process.env.LINKSIM_QUERY_COST_REPORT && label) {
    writeFileSync(`${process.env.LINKSIM_QUERY_COST_REPORT}-${label}.json`, JSON.stringify({ ...fixtureData, measurement: JSON.parse(result.stdout) }));
  }
  return JSON.parse(result.stdout) as { steps: number; results: unknown[][] };
};

const fixture = (historyCount = 100, resourceCount = 100) => {
  const db = new SqliteD1();
  db.db.exec(`
    INSERT INTO users (id, username, is_admin) VALUES ('owner', 'Owner', 0), ('reader', 'Reader', 0);
    INSERT INTO verified_identity_claims VALUES ('reader@example.com', 'reader', 'active', '2026-01-01', '2026-01-01', NULL, NULL);
    INSERT INTO identity_subject_states VALUES ('reader', 'reader@example.com', 'current', 'reader', 1, '2026-01-01', '2026-01-01', NULL);
  `);
  const simulation = db.db.prepare(`INSERT INTO simulations (id, owner_user_id, name, visibility, status, payload_json, updated_at)
    VALUES (?, 'owner', ?, 'private', 'active', '{}', '2026-09-08T10:00:00.000Z')`);
  const history = db.db.prepare(`INSERT INTO resource_changes
    (resource_kind, resource_id, action, actor_user_id, changed_at, snapshot_json, details_json)
    VALUES ('simulation', ?, 'updated', 'owner', ?, ?, '{}')`);
  db.db.exec("BEGIN");
  for (let resource = 0; resource < resourceCount; resource++) {
    const id = `sim-${String(resource).padStart(3, "0")}`;
    simulation.run(id, id);
    for (let entry = 0; entry < historyCount; entry++) {
      history.run(id, `2026-09-08T10:${String(entry % 60).padStart(2, "0")}:00.000Z`,
        JSON.stringify({ ownerUserId: "owner", visibility: "private", sharedWith: [] }));
    }
  }
  db.db.exec("COMMIT");
  return db;
};

const removalQuery = async (db: SqliteD1) => {
  await fetchLibraryForUser({ DB: db } as never, "reader", { phase: "removed_simulations", limit: 100 });
  const query = db.statements.findLast(({ sql }) => sql.includes("current_role"));
  if (!query) throw new Error("Removal query was not executed");
  return query;
};

// The pre-0.28.1 predicate is retained only as a correctness/cost oracle.
const originalRemoval: Query = {
  sql: `SELECT live.id FROM simulations live
    LEFT JOIN simulation_roles current_role ON current_role.simulation_id = live.id AND current_role.user_id = ?
    WHERE live.owner_user_id != ? AND live.visibility = 'private' AND current_role.user_id IS NULL AND live.status = 'active'
      AND EXISTS (SELECT 1 FROM resource_changes changed
        WHERE changed.resource_kind = ? AND changed.resource_id = live.id
          AND (EXISTS (SELECT 1 FROM resource_changes history
            WHERE history.resource_kind = changed.resource_kind AND history.resource_id = changed.resource_id AND history.id < changed.id
              AND (json_extract(history.snapshot_json, '$.ownerUserId') = ?
                OR json_extract(history.snapshot_json, '$.visibility') IN ('public', 'shared')
                OR EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(history.snapshot_json, '$.sharedWith'), '[]')) grant_entry
                  WHERE json_extract(grant_entry.value, '$.userId') = ?)))
            OR json_extract(changed.details_json, '$.diff.visibility.before') IN ('public', 'shared')
            OR EXISTS (SELECT 1 FROM json_each(COALESCE(json_extract(changed.details_json, '$.diff.sharedWith.before'), '[]')) previous_grant
              WHERE json_extract(previous_grant.value, '$.userId') = ?)))
      AND live.id > ? ORDER BY live.id LIMIT ?`,
  values: ["reader", "reader", "simulation", "reader", "reader", "reader", "", 101],
};

describe("D1 query work budgets", () => {
  it.each(["site", "simulation"] as const)("preserves paged %s visibility and administrator access without duplicates", async (kind) => {
    const db = fixture(0, 0);
    const table = kind === "site" ? "sites" : "simulations";
    const roles = kind === "site" ? "site_roles" : "simulation_roles";
    const phase = kind === "site" ? "sites" : "simulations";
    const collection = kind === "site" ? "siteLibrary" : "simulationPresets";
    for (const [id, owner, visibility] of [
      ["a-owned", "reader", "private"], ["b-overlap", "reader", "public_read"],
      ["c-public", "owner", "public_read"], ["d-shared", "owner", "public_write"],
      ["e-hidden", "owner", "private"], ["f-stale-grant", "owner", "private"],
    ]) {
      db.db.prepare(`INSERT INTO ${table} (id, owner_user_id, name, visibility, payload_json, updated_at)
        VALUES (?, ?, ?, ?, ?, '2026-01-01')`).run(id, owner, id, visibility, JSON.stringify({ id, name: id }));
    }
    for (const id of ["b-overlap", "d-shared", "f-stale-grant"]) {
      db.db.prepare(`INSERT INTO ${roles} VALUES (?, 'reader', 'editor', '2026-01-01')`).run(id);
    }
    const read = (afterId = "") => fetchLibraryForUser({ DB: db } as never, "reader", { phase, limit: 2, afterId });
    for (const moderator of [0, 1]) {
      db.db.prepare("UPDATE users SET is_moderator = ? WHERE id = 'reader'").run(moderator);
      const first = await read();
      expect(first[collection].map(row => row.id)).toEqual(["a-owned", "b-overlap"]);
      const second = await read(first.nextCursor!.afterId);
      expect(second[collection].map(row => row.id)).toEqual(["c-public", "d-shared"]);
    }
    if (kind === "simulation") db.db.exec("UPDATE simulations SET status = 'deleted' WHERE id = 'c-public'");
    const ordinary = await fetchLibraryForUser({ DB: db } as never, "reader");
    expect(ordinary[collection].map(row => row.id).sort()).toEqual(kind === "site"
      ? ["a-owned", "b-overlap", "c-public", "d-shared"] : ["a-owned", "b-overlap", "d-shared"]);
    db.db.exec("UPDATE users SET is_admin = 1 WHERE id = 'reader'");
    const admin = await fetchLibraryForUser({ DB: db } as never, "reader", { phase });
    expect(admin[collection].map(row => row.id)).toEqual(["a-owned", "b-overlap", "c-public", "d-shared", "e-hidden", "f-stale-grant"]);
    db.db.close();
  });

  it("applies the additive history index idempotently without changing history", () => {
    const db = fixture(10, 2);
    db.db.exec("DROP INDEX idx_resource_changes_window");
    const before = db.db.prepare("SELECT * FROM resource_changes ORDER BY id").all();
    const sql = readFileSync("db/migrations/2026-09-11_library_change_window.sql", "utf8");
    db.db.exec(sql);
    db.db.exec(sql);
    expect(db.db.prepare("SELECT * FROM resource_changes ORDER BY id").all()).toEqual(before);
    expect(db.db.prepare("PRAGMA index_info(idx_resource_changes_window)").all().map(row => row.name))
      .toEqual(["resource_kind", "changed_at", "resource_id"]);
    db.db.close();
  });

  it.each(["site", "simulation"] as const)("keeps %s reads independent of unrelated private resource count", async (kind) => {
    const table = kind === "site" ? "sites" : "simulations";
    const phase = kind === "site" ? "sites" : "simulations";
    const removalPhase = kind === "site" ? "removed_sites" : "removed_simulations";
    const run = async (count: number) => {
      const db = fixture(0, 0);
      db.db.prepare(`WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n < ?)
        INSERT INTO ${table} (id, owner_user_id, name, visibility, payload_json, updated_at)
        SELECT 'private-'||n, 'owner', 'Hidden', 'private', '{}', '2026-01-01' FROM ids`).run(count);
      db.db.exec(`INSERT INTO ${table} (id, owner_user_id, name, visibility, payload_json, updated_at)
        VALUES ('mine', 'reader', 'Mine', 'private', '{"id":"mine","name":"Mine"}', '2026-01-01')`);
      const queries: Query[] = [];
      for (const readPhase of [phase, removalPhase]) {
        await fetchLibraryForUser({ DB: db } as never, "reader", { phase: readPhase, afterId: "", limit: 20 });
        queries.push(db.statements.findLast(({ sql }) => sql.includes(readPhase === phase ? "SELECT s.payload_json" : "current_role"))!);
      }
      const result = measure(db, queries);
      db.db.close();
      return result;
    };
    const small = await run(100);
    const large = await run(10000);
    expect(large.results).toEqual(small.results);
    expect(large.steps).toBeLessThanOrEqual(small.steps + 1000);
  });

  it("does not scan old history for empty removal and deletion deltas", async () => {
    const run = async (depth: number) => {
      const db = fixture(depth, 100);
      // Exercise Site deletion history too, without changing the fixture size.
      db.db.exec("UPDATE resource_changes SET resource_kind = 'site'");
      await fetchLibraryForUser({ DB: db } as never, "reader", {
        phase: "removed_sites", since: "2026-09-10T00:00:00.000Z", cutoff: "2026-09-11T00:00:00.000Z",
      });
      const removal = db.statements.findLast(({ sql }) => sql.includes("current_role"))!;
      await fetchLibraryForUser({ DB: db } as never, "reader", {
        phase: "deleted_sites", since: "2026-09-10T00:00:00.000Z", cutoff: "2026-09-11T00:00:00.000Z",
      });
      const deletion = db.statements.findLast(({ sql }) => sql.includes("FROM resource_changes tombstone"))!;
      const result = measure(db, [removal, deletion]);
      db.db.close();
      return result;
    };
    const small = await run(10);
    const large = await run(1000);
    expect(large.results).toEqual([[], []]);
    expect(large.steps).toBeLessThanOrEqual(small.steps + 500);
    expect(large.steps).toBeLessThan(1000);
  }, 30000);

  it.each(["site", "simulation"] as const)("preserves %s removal audiences, windows and pagination", async (kind) => {
    const db = fixture(0, 0);
    const table = kind === "site" ? "sites" : "simulations";
    const roles = kind === "site" ? "site_roles" : "simulation_roles";
    const phase = kind === "site" ? "removed_sites" : "removed_simulations";
    const marker = kind === "site" ? "removedSiteIds" : "removedSimulationIds";
    const before = "2026-09-07T00:00:00.000Z";
    const since = "2026-09-08T10:00:00.000Z";
    const cutoff = "2026-09-08T11:00:00.000Z";
    const future = "2026-09-08T12:00:00.000Z";
    const privateSnapshot = { ownerUserId: "owner", visibility: "private", sharedWith: [] };
    const add = (id: string) => db.db.prepare(`INSERT INTO ${table}
      (id, owner_user_id, name, visibility, payload_json, updated_at)
      VALUES (?, 'owner', ?, 'private', ?, ?)`)
      .run(id, id, JSON.stringify({ id, name: id, visibility: "private" }), since);
    const change = (id: string, at: string, snapshot: unknown = privateSnapshot, details: unknown = {}) =>
      db.db.prepare(`INSERT INTO resource_changes
        (resource_kind, resource_id, actor_user_id, changed_at, snapshot_json, details_json)
        VALUES (?, ?, 'owner', ?, ?, ?)`)
        .run(kind, id, at, JSON.stringify(snapshot), JSON.stringify(details));

    for (const [id, snapshot] of [
      ["a-public", { visibility: "public" }],
      ["b-shared", { visibility: "shared" }],
      ["c-grant", { sharedWith: [{ userId: "reader", role: "viewer" }] }],
      ["d-owner", { ownerUserId: "reader" }],
    ] as const) {
      add(id); change(id, before, snapshot); change(id, since);
    }
    add("e-before-visibility");
    change("e-before-visibility", cutoff, privateSnapshot, { diff: { visibility: { before: "public" } } });
    add("f-before-grant");
    change("f-before-grant", cutoff, privateSnapshot, { diff: { sharedWith: { before: [{ userId: "reader" }] } } });
    add("g-never"); change("g-never", before); change("g-never", since);
    add("h-latest-only"); change("h-latest-only", since, { visibility: "public" });
    add("i-after-cutoff"); change("i-after-cutoff", since); change("i-after-cutoff", future, { visibility: "public" });
    add("j-old-only"); change("j-old-only", before, privateSnapshot, { diff: { visibility: { before: "public" } } });
    add("k-restored"); change("k-restored", before, { visibility: "public" }); change("k-restored", since);
    db.db.prepare(`INSERT INTO ${roles} VALUES (?, 'reader', 'viewer', ?)`)
      .run("k-restored", since);
    add("l-owned"); change("l-owned", before, { visibility: "public" }); change("l-owned", since);
    db.db.prepare(`UPDATE ${table} SET owner_user_id = 'reader' WHERE id = 'l-owned'`).run();
    add("m-deleted"); change("m-deleted", before, { visibility: "public" }); change("m-deleted", since);
    if (kind === "simulation") db.db.exec("UPDATE simulations SET status = 'deleted' WHERE id = 'm-deleted'");
    else {
      db.db.exec("DELETE FROM sites WHERE id = 'm-deleted'");
      db.db.prepare("UPDATE resource_changes SET note = 'Deleted Site' WHERE resource_id = 'm-deleted' AND changed_at = ?").run(since);
    }
    // ID order, not timestamp order, defines 'prior history' in the existing contract.
    add("n-id-order"); change("n-id-order", cutoff, { visibility: "public" }); change("n-id-order", since);
    const expected = ["a-public", "b-shared", "c-grant", "d-owner", "e-before-visibility", "f-before-grant", "n-id-order"];
    const read = (opts: Parameters<typeof fetchLibraryForUser>[2]) => fetchLibraryForUser({ DB: db } as never, "reader", opts);
    expect((await read({ phase, since, cutoff }))[marker]).toEqual(expected);
    expect((await read({ phase, since: future, cutoff: future }))[marker]).toEqual([]);
    expect((await read({ phase }))[marker]).toEqual([...expected.slice(0, 6), "j-old-only", "n-id-order"]);
    const first = await read({ phase, since, cutoff, limit: 2 });
    expect(first[marker]).toEqual(expected.slice(0, 2));
    expect(first.nextCursor).toEqual({ phase, afterId: "b-shared" });
    expect((await read({ phase, since, cutoff, afterId: first.nextCursor?.afterId, limit: 2 }))[marker])
      .toEqual(expected.slice(2, 4));
    expect((await read({ since, cutoff }))[marker].sort()).toEqual(expected);
    const deletedPhase = kind === "site" ? "deleted_sites" : "deleted_simulations";
    const deletedMarker = kind === "site" ? "deletedSiteIds" : "deletedSimulationIds";
    expect((await read({ phase: deletedPhase, since, cutoff }))[deletedMarker]).toContain("m-deleted");
    db.db.exec("UPDATE users SET is_admin = 1 WHERE id = 'reader'");
    expect((await read({ phase, since, cutoff }))[marker]).toEqual([]);
    db.db.close();
  });

  it("removes repeated history scans and scales linearly with history depth", async () => {
    const small = fixture();
    const query = await removalQuery(small);
    const original = measure(small, [originalRemoval], "removal-original");
    const optimized = measure(small, [query], "removal-optimized");
    expect(optimized.results).toEqual(original.results);
    expect(optimized.steps).toBeLessThan(original.steps * 0.1);
    const large = fixture(1000);
    const scaled = measure(large, [await removalQuery(large)], "removal-scaled");
    expect(scaled.results).toEqual(optimized.results);
    expect(scaled.steps).toBeLessThan(optimized.steps * 12);
    small.db.close();
    large.db.close();
  }, 30_000);

  it("does not scan unrelated history during same-identity reconciliation", async () => {
    const small = fixture();
    await executeVerifiedIdentityEnsure({ DB: small } as never, {
      userId: "reader", email: "reader@example.com", defaultEmail: "reader@example.com",
      bootstrapAdmin: false, now: "2026-09-08T12:00:00.000Z",
    });
    const queries = small.statements;
    const baseline = measure(small, queries, "identity-small");
    const large = fixture(1000);
    const scaled = measure(large, queries, "identity-large");
    expect(scaled.steps).toBeLessThanOrEqual(baseline.steps + 500);
    const wider = fixture(100, 1000);
    const widerCost = measure(wider, queries, "identity-wider");
    expect(widerCost.steps).toBeLessThanOrEqual(baseline.steps + 500);
    small.db.close();
    large.db.close();
    wider.db.close();
  }, 30_000);
});
