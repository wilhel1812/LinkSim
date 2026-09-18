# Synthetic history archive on a private Durable Object

On 2026-09-18, the disposable gateway called a separate SQLite-backed Durable
Object holding the synthetic D1 and R2 bindings. All 26 measured requests returned
200 and were matched, in order and by path, to 26 sanitized gateway traces and 26
object traces. An anonymous request returned 404 before the object call. The
gateway trace version was `23464edc-d6db-4735-b438-ff295d1f6221`; the object
trace version was `ae9afa64-d2d3-4308-80cd-4abbf0b0dc5e`.

| Operation | Requests | Gateway CPU | Object CPU | End-to-end elapsed |
| --- | ---: | ---: | ---: | ---: |
| Archive, including two ten-row pages per max-batch fixture | 10 | 0–1 ms | 2–72 ms | 398–5,654 ms |
| Hydrate | 8 | 0–1 ms | 1–6 ms | 117–204 ms |
| Restore | 8 | 0–1 ms | 2–7 ms | 156–314 ms |

The four ten-row archive page requests used 62–72 ms object CPU and 4,312–5,301
ms object wall time each. Each page used 11 D1 queries, 20 rows read, 10 written,
10 R2 puts and 10 verification gets. Across all 26 measured requests, request
metrics totalled 116 D1 rows read, 54 written, 46 R2 puts and 62 gets. Fixture
creation was excluded. The measured object wall times sum to 23.5 seconds; this
is not a billable-duration total because the object may remain active between
requests. The gateway stayed below the Pages 10 ms CPU limit in every recorded
request. The object work is well below the documented 30-second default CPU
limit. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/),
[Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).

This is one sequential sample per scenario and entropy. It does not measure a
cold start, a burst, an authenticated application request, production indexes,
database growth, object duration between calls, or account-wide quota headroom.
The D1 counts are lower bounds because the disposable table has no production
indexes. The free plan also meters Durable Object requests, duration, and SQLite
storage separately from D1 and R2. These numbers prove runtime compatibility,
not capacity acceptance for 1,000 registered users.

The disposable gateway Worker, runtime Worker, D1 database, R2 bucket and local
probe key were removed. The exact aggregate results and sanitized matching trace
fields are in [JSON evidence](2026-09-18-history-durable.json). No real user data
or production configuration was used.
