# Indexed mixed-history cost and staging size snapshot

On 2026-09-18, four read-only aggregate queries against the **staging** D1
database returned counts and byte lengths only. They read 31,449 rows in total,
wrote none, and returned no resource content or user identity. At that instant:

| Kind | Revisions | Stored snapshot + details bytes | Mean | Maximum | Estimated archive candidates |
| --- | ---: | ---: | ---: | ---: | ---: |
| Simulation | 3,845 | 17,778,010 | 4,624 | 17,850 | 2,155 |
| Site | 5,356 | 4,318,932 | 806 | 2,026 | 0 |

The candidate estimate removes `$.snapshot` and `$.diff.snapshot` with SQLite
`json_remove` and counts rows with at least 2,048 bytes removed. It approximates
the prototype's JavaScript serialization; it is not an exact dry run. All SQL
lengths cast text to BLOB first, so SQLite counts UTF-8 bytes rather than
characters. None of
the 9,201 rows had a non-JSON snapshot or non-JSON non-null details field at
this snapshot. Estimated
removable bytes across candidate Simulations were 13,335,790. Of the 2,155
candidate Simulations, 796 were currently public/shared, seven had a
public/shared prior visibility in the details, and 284 had a nonempty grant
array. Those groups can overlap. The staging database was 30,412,800 bytes.
These are a dated staging snapshot, not production totals or a forecast of
1,000 accounts. Staging may be a sanitized or incomplete copy of production.

The exact aggregate SQL was run one statement at a time with Wrangler D1
`execute linksim_staging --remote --config wrangler.staging.toml --json`:

```sql
SELECT resource_kind, COUNT(*) AS revisions,
  SUM(LENGTH(CAST(COALESCE(snapshot_json,'') AS BLOB))+LENGTH(CAST(COALESCE(details_json,'') AS BLOB))) AS stored_bytes,
  ROUND(AVG(LENGTH(CAST(COALESCE(snapshot_json,'') AS BLOB))+LENGTH(CAST(COALESCE(details_json,'') AS BLOB)))) AS mean_bytes,
  MAX(LENGTH(CAST(COALESCE(snapshot_json,'') AS BLOB))+LENGTH(CAST(COALESCE(details_json,'') AS BLOB))) AS max_bytes,
  SUM(CASE WHEN LENGTH(CAST(COALESCE(snapshot_json,'') AS BLOB))+LENGTH(CAST(COALESCE(details_json,'') AS BLOB))<2048 THEN 1 ELSE 0 END) AS small_rows,
  SUM(CASE WHEN LENGTH(CAST(COALESCE(snapshot_json,'') AS BLOB))+LENGTH(CAST(COALESCE(details_json,'') AS BLOB))>=65536 THEN 1 ELSE 0 END) AS large_rows
FROM resource_changes GROUP BY resource_kind;

WITH sizes AS (
  SELECT resource_kind,
    LENGTH(CAST(COALESCE(snapshot_json,'') AS BLOB))+LENGTH(CAST(COALESCE(details_json,'') AS BLOB)) AS before_bytes,
    CASE WHEN json_valid(snapshot_json) THEN LENGTH(CAST(snapshot_json AS BLOB))-LENGTH(CAST(json_remove(snapshot_json,'$.snapshot') AS BLOB)) ELSE 0 END
    + CASE WHEN json_valid(details_json) THEN LENGTH(CAST(details_json AS BLOB))-LENGTH(CAST(json_remove(details_json,'$.diff.snapshot') AS BLOB)) ELSE 0 END AS estimated_removed_bytes
  FROM resource_changes
)
SELECT resource_kind, COUNT(*) AS revisions,
  SUM(CASE WHEN estimated_removed_bytes>=2048 THEN 1 ELSE 0 END) AS candidate_rows,
  ROUND(AVG(estimated_removed_bytes)) AS mean_removed_bytes,
  SUM(CASE WHEN estimated_removed_bytes>=2048 THEN estimated_removed_bytes ELSE 0 END) AS candidate_removed_bytes
FROM sizes GROUP BY resource_kind;

WITH candidates AS (
  SELECT snapshot_json, details_json,
    (CASE WHEN json_valid(snapshot_json) THEN LENGTH(CAST(snapshot_json AS BLOB))-LENGTH(CAST(json_remove(snapshot_json,'$.snapshot') AS BLOB)) ELSE 0 END
    + CASE WHEN json_valid(details_json) THEN LENGTH(CAST(details_json AS BLOB))-LENGTH(CAST(json_remove(details_json,'$.diff.snapshot') AS BLOB)) ELSE 0 END) AS removed
  FROM resource_changes WHERE resource_kind='simulation'
)
SELECT COUNT(*) AS candidate_rows,
  SUM(CASE WHEN json_extract(snapshot_json,'$.visibility') IN ('public','shared') THEN 1 ELSE 0 END) AS current_public_shared,
  SUM(CASE WHEN json_valid(details_json) AND json_extract(details_json,'$.diff.visibility.before') IN ('public','shared') THEN 1 ELSE 0 END) AS former_public_shared,
  SUM(CASE WHEN COALESCE(json_extract(snapshot_json,'$.sharedWith'),'[]')!='[]' THEN 1 ELSE 0 END) AS granted
FROM candidates WHERE removed>=2048;

SELECT COUNT(*) AS revisions,
  SUM(CASE WHEN snapshot_json IS NOT NULL AND NOT json_valid(snapshot_json) THEN 1 ELSE 0 END) AS invalid_snapshots,
  SUM(CASE WHEN details_json IS NOT NULL AND NOT json_valid(details_json) THEN 1 ELSE 0 END) AS non_json_details
FROM resource_changes;
```

In order, D1 reported 9,201, 9,201, 3,846 and 9,201 rows read, all with
zero writes and one attempt. The first query also returned 925 Simulation rows
under 2 KB and 5,356 Site rows under 2 KB, with zero rows of either kind at
or above 64 KB. The second query returned 2,155 candidate Simulations,
13,335,790 candidate removed bytes, and no candidate Sites. The third returned
2,155 candidates, 796 current public/shared, seven former public/shared and
284 with grants. The fourth returned 9,201 revisions, zero invalid snapshots
and zero non-JSON non-null details. All four reported a 30,412,800-byte
database afterward. SQL and aggregates are included for reproducibility;
repeat queries will see later staging state and consume additional reads.

The existing local gateway → private Durable Object → indexed application D1
and R2 probe then used a deterministic **large-record stress fixture**: 99
bulky Simulation revisions, of which 37 were currently public/shared and one
was formerly public, plus one compact public deleted Site. This holds the
audience fraction near staging's 796/2,155 while deliberately using much
larger records than observed in staging. The full application history indexes
were present; fixture creation was excluded from request counts.

| Operation | Requests | D1 queries | Rows read | Rows written | R2 PUT | R2 GET |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Archive ten pages | 10 | 109 | 199 | 236 | 99 | 99 |
| Hydrate four archived rows and the Site | 5 | 5 | 5 | 0 | 0 | 4 |
| Restore four archived rows | 4 | 8 | 8 | 11 | 0 | 4 |

All 99 bulky Simulations converted; the Site remained unarchived. The first
three pages containing audience rows wrote 30 D1 rows each versus 20 for
private-only ten-row pages. One formerly public row added an index write in the
fourth page. The last page converted nine rows and wrote 18. Restored private,
public, shared, and formerly public rows exactly matched their original JSON;
the archive projection retained ownership and current visibility. Across the
ten pages, the synthetic source fields totaled 19,434,456 bytes and the
projected fields 23,327 bytes, while the immutable R2 envelopes totaled
20,227,347 bytes. These large payloads are intentionally unlike the staging
mean; multiplying them by the candidate count would be misleading.

[Per-request local results](2026-09-18-history-mix-local.json) include only
metrics, synthetic scenario names and operation paths. Reproduce with
`node experiments/better-auth/history-archive-durable-local.mjs --indexed --mixed`.
Local object elapsed time is wall time, **not Cloudflare billed CPU**. The
probe does not measure current application authorization, archived revert,
real retention, a populated production-sized index, or shared account-wide
quota. It does not enable the prototype or accept the auth capacity gate.
