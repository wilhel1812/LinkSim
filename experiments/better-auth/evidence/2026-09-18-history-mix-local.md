# Indexed mixed-history cost and staging size snapshot

On 2026-09-18, four read-only aggregate queries against the **staging** D1
database returned counts and byte lengths only. They read 31,449 rows in total,
wrote none, and returned no resource content or user identity. At that instant:

| Kind | Revisions | Stored snapshot + details bytes | Mean | Maximum | Estimated archive candidates |
| --- | ---: | ---: | ---: | ---: | ---: |
| Simulation | 3,845 | 17,747,055 | 4,616 | 17,837 | 2,155 |
| Site | 5,356 | 4,314,984 | 806 | 2,025 | 0 |

The candidate estimate removes `$.snapshot` and `$.diff.snapshot` with SQLite
`json_remove` and counts rows with at least 2,048 bytes removed. It approximates
the prototype's JavaScript serialization; it is not an exact dry run. None of
the 9,201 rows had a non-JSON snapshot or non-JSON non-null details field at
this snapshot. Estimated
removable bytes across candidate Simulations were 13,308,623. Of the 2,155
candidate Simulations, 796 were currently public/shared, seven had a
public/shared prior visibility in the details, and 284 had a nonempty grant
array. Those groups can overlap. The staging database was 30,412,800 bytes.
These are a dated staging snapshot, not production totals or a forecast of
1,000 accounts. Staging may be a sanitized or incomplete copy of production.

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
