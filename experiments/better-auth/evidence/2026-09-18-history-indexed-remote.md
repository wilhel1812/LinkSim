# Disposable remote archive probe with application history indexes

On 2026-09-18, the existing secret-guarded gateway called the private archive
Durable Object with a **synthetic private Simulation** fixture in a disposable
D1 database and R2 bucket. The database used the complete `db/schema.sql` and
all six history indexes, plus two prototype archive columns. The gateway held
no D1/R2 bindings. All 26 measured operations returned 200 and matched, in
order, by path, status, and request time to 26 sanitized gateway traces and 26
object traces. The separate anonymous gateway request returned 404 before the
object. No production, staging, or personal data was used.

| Operation | Requests | Gateway CPU | Object CPU | End-to-end elapsed |
| --- | ---: | ---: | ---: | ---: |
| Archive, including four ten-row pages | 10 | 0–1 ms | 2–89 ms | 386–5,846 ms |
| Hydrate | 8 | 0–1 ms | 1–8 ms | 160–212 ms |
| Restore | 8 | 0–1 ms | 1–7 ms | 181–481 ms |

The four ten-row archive pages used 68, 76, 80 and 89 ms object CPU, with 20
D1 rows written per page. The two maximum-record archives used 13 and 19 ms
object CPU with two D1 rows written each. Across 26 requests, measured totals
were **80 D1 queries, 116 rows read, 108 rows written, 46 R2 PUTs and 62 R2
GETs**. This reproduces the [local indexed result](2026-09-18-history-index-cost.md)
and doubles the 54 D1 writes in the earlier remote minimal-table probe. The
gateway CPU remained 0–1 ms in each recorded request. The elapsed values
include network and storage waiting; they are not billed CPU.

Fixture inserts and rebuilding the application history indexes were outside
the measured request interval, though they still consumed disposable account
quota. The loader drops only those history indexes while assembling chunked
JSON, then recreates them before the measured calls. Without that step, JSON
expression indexes correctly reject incomplete intermediate values.

These are one request per operation and entropy variant, not a distribution.
There was no guaranteed cold start, 50-request burst, authenticated application
revert, production-sized populated index, representative shared/public or
deleted-Site history, or account-wide quota/duration projection. This result
supports the separate maintenance runtime but does **not** accept capacity for
1,000 registered users or authorize archive activation or Access cutover.

Gateway trace version: `88ad5088-4eef-4e38-9b31-14256e61cca1`.
Object trace version: `7c6140be-f3c0-46b4-8c76-5d1a3569fe5d`.
The exact [request results](2026-09-18-history-indexed-remote.json),
[gateway traces](2026-09-18-history-indexed-gateway-tail.jsonl), and
[object traces](2026-09-18-history-indexed-object-tail.jsonl) contain only
selected cost fields, no tokens or request headers. After the run, the
disposable gateway Worker, runtime Worker, R2 bucket and D1 database were
deleted; the local probe key was removed.

Reproduce using the guarded lifecycle in
[history-archive.md](../history-archive.md), passing `--indexed` only to the
`run` action. Never point this script at application bindings.
