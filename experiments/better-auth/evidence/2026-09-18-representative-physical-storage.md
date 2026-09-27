# Representative synthetic D1 storage check (2026-09-18)

This measures one disposable D1 database. It does **not** archive real data,
change staging or production, or prove that a 1,000-account production database
will have the same composition. The database was deleted after the test.

`representative-storage.mjs` generates synthetic rows from the dated staging
aggregates in [history-mix-local.md](2026-09-18-history-mix-local.md): 3,845
Simulation and 5,356 Site revisions, including 2,155 Simulation candidates.
It loads the full application schema and its history indexes. Fixture JSON is
random synthetic padding shaped like the measured rows; the source aggregate
sizes match within a few percent. No real content or identifiers are copied.

| Stage | D1 `size_after` | Rows written in stage | Meaning |
| --- | ---: | ---: | --- |
| Schema only | 262,144 bytes | 81 | Application plus current Better Auth *probe* schema |
| 50 app users and 9,201 revisions | 32,604,160 bytes | 47,011 | Synthetic staging-like history mix, indexed |
| Project 2,155 candidates | 23,769,088 bytes | 5,123 | Remove large history fields; synthetic, nonrecoverable archive keys |
| Add auth allowance | 24,690,688 bytes | 15,900 | 950 further app users, 1,000 auth users/accounts/sessions/rate-limit rows and 250 passkeys |

The projection physically removed **8,835,072 bytes**, or 27.1% of this
fixture's baseline size, versus about 13.3 MB of candidate JSON. It cost
**2.38 D1 rows written per candidate** with indexes. A separate R2 test is
still needed for recoverable archive objects and retention; the D1-only keys
in this fixture intentionally point nowhere.

The measured 921,600-byte auth allowance is **incremental to the 50-account
projected fixture**. A simple 20-fold scaling of that fixture plus the
incremental allowance gives **476,303,360 bytes** for 1,000 accounts, leaving
**23,696,640 bytes (4.7%)** under a conservative 500,000,000-byte ceiling.
This is a sensitivity, not a capacity guarantee: the live 50-account
production database is 90,234,880 bytes, much larger than the synthetic
staging-like baseline, and storage is strongly skewed between users. The
accepted approximately 958-account prior storage-only sensitivity remains
accepted as a planning risk; this new observation confirms physical savings
but does not justify claiming comfortable headroom or waiving future monitoring.

On the dated production aggregate, 5,426 candidate revisions included 1,446
with audience-index effects. Applying the locally observed two writes per
private row plus one audience write gives a **12,298-write backfill sensitivity**
at today's 50-account size, or **245,960 writes** if this backlog scaled 20x.
A ceiling of **8,000 maintenance writes/day** would spread that hypothetical
backfill over at least **31 days**, leaving no room for all of it on one day.
Adding 8,000 to the previously accepted **53,700-write/day** scenario yields
**61,700 writes/day**, or 61.7% of D1's 100,000/day free allowance. The 53,700
figure already includes staging and abuse assumptions, so they must not be
added a second time. These are workload sensitivities, not observed daily use.
The test fixture itself used 68,115 D1 writes across setup, projection, and
auth allowance; it was a one-time disposable experiment, not an operating plan.

The production audience count was measured read-only with
`wrangler d1 execute linksim --remote --config wrangler.toml --command <SQL>
--json` on 2026-09-18. It returned `candidates=5426` and
`audience_index_candidates=1446`, with 6,466 rows read, **zero written**, one
attempt, and unchanged `size_after=90234880`. The query mirrors the existing
partial audience-index predicate and returns no identities or JSON content:

```sql
WITH c AS (
  SELECT snapshot_json, details_json,
    LENGTH(CAST(snapshot_json AS BLOB))
      - LENGTH(CAST(json_remove(snapshot_json, '$.snapshot') AS BLOB))
    + LENGTH(CAST(details_json AS BLOB))
      - LENGTH(CAST(json_remove(details_json, '$.diff.snapshot') AS BLOB)) AS removed
  FROM resource_changes
  WHERE resource_kind = 'simulation'
    AND json_valid(snapshot_json) AND json_valid(details_json)
)
SELECT COUNT(*) AS candidates,
  SUM(CASE WHEN
    json_extract(snapshot_json, '$.visibility') IN ('public', 'shared')
    OR COALESCE(json_extract(snapshot_json, '$.sharedWith'), '[]') != '[]'
    OR json_extract(details_json, '$.diff.visibility.before') IN ('public', 'shared')
    OR COALESCE(json_extract(details_json, '$.diff.sharedWith.before'), '[]') != '[]'
    THEN 1 ELSE 0 END) AS audience_index_candidates
FROM c WHERE removed >= 2048;
```

The remaining release gate is to reconcile measured **account-wide** request,
D1 read/write, Durable Object duration, and CPU usage with the post-foundations
application activity mix. In particular, registered users are not daily active
users. The operational archive path must also bound actual R2 storage and
retention costs before production archive writes. Production Access remains in
place and auth integration is still separate work.

## Reproduction

Run `npm run test -- --run scripts/representative-storage.test.mjs`, then generate four
SQL phases with `node experiments/better-auth/representative-storage.mjs
<temporary-directory>`. Import the phases in order into a **new disposable D1
database** with `wrangler d1 execute <disposable-name> --remote --file
<phase-file> --yes --json`; record each `size_after` and `rows_written`.
Delete that database immediately afterward. The SQL projection has no R2
object store and must never be used for application data. The probe schema is
an allowance only; repeat this measurement when the final auth schema exists.

Free-tier figures above use current [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
and [pricing](https://developers.cloudflare.com/d1/platform/pricing/); recheck
them at the release gate.
