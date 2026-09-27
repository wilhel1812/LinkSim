# Maximum-record archive probe on staging

Issue #1107; 2026-09-18. Reused the reviewed, short-lived staging-only
Worker/Durable Object from [the small-row probe](2026-09-18-history-deployed-cpu.md)
against a **synthetic** maximum-record revision in the existing staging D1
with all application history indexes. No real user's history or production
resource was changed, and the application archive writer remains disabled.

The existing `archiveFixtureRows('max-record', 'varied')` generator produced
262,144 bytes of snapshot JSON and 523,981 bytes of details JSON (786,125
total). The combined texts' SHA-256 was
`9bd1407ab16ca6c867af39a015b0589920f24ab0f0aace1602a5edb67c3ba844`.
The row used ID `9203`, resource
`archive-rehearsal-large-sim-1107-20260918`, and the existing synthetic actor.
It is deliberately not a user-accessible Simulation.

The initial single-statement `wrangler d1 execute` import was rejected with
`SQLITE_TOOBIG`; a read confirmed it inserted no row. D1 also rejected a
connection-local temporary table with `SQLITE_AUTH`. The fixture was then
assembled in a uniquely named staging scratch table using 59 SQL statements,
each at most 14,093 bytes, following the existing indexed-fixture chunking
pattern. A read verified both JSON fields, exact lengths and valid JSON. One
conditional `INSERT ... SELECT` copied the complete values into the indexed
`resource_changes` table. A read confirmed byte-for-byte equality, and the
scratch table was dropped **before** the archive measurement. Fixture setup
is excluded from the operation metrics below.

| Operation | HTTP | Client elapsed | D1 queries / read / written | R2 put / get / list | Two invocation CPU values |
|---|---:|---:|---:|---:|---:|
| Dry run | 200 | 669 ms | 2 / 2 / 0 | 0 / 0 / 0 | 1 + 14 ms |
| Archive | 200 | 911 ms | 3 / 3 / 2 | 1 / 1 / 0 | 22 + 0 ms |
| Hydrate | 200 | 347 ms | 2 / 2 / 0 | 0 / 1 / 0 | 9 + 2 ms |
| Restore | 200 | 441 ms | 3 / 3 / 2 | 0 / 1 / 0 | 11 + 1 ms |
| R2 count after | 200 | 343 ms | 1 / 1 / 0 | 0 / 0 / 1 | 2 + 1 ms |

All ten sanitized invocation traces returned `200/ok` under one deployed
script version. The tail does not label gateway versus object, so the two CPU
values are left unattributed. The archive call's highest single invocation
was **22 ms CPU**; the paired invocation was 0 ms. It projected the 786,125
D1 JSON bytes to 229 bytes and wrote an 805,825-byte R2 envelope. Hydration
returned 786,125 bytes. After restore, a read-only client-side comparison of
both full JSON strings matched the original fixture byte for byte, with null
archive references. R2 listed one retained object under this row's private
staging prefix. The temporary Worker was deleted; one transient Wrangler
network failure on deletion was retried successfully. The synthetic D1 row
remains inline and the private R2 object is retained for Time Travel safety.

The [sanitized operation records](2026-09-18-history-max-record-results.jsonl)
and [Cloudflare tail](2026-09-18-history-max-record-tail.jsonl) contain only
counts, timings, a synthetic ID and digest; no secret, raw URL or payload.
Cloudflare currently documents a [10 ms Workers Free request CPU limit](https://developers.cloudflare.com/workers/platform/limits/)
and a [30-second default Durable Object CPU limit](https://developers.cloudflare.com/durable-objects/platform/limits/).
The 22 ms archive invocation therefore reinforces the separation of archive
maintenance from the Pages gateway. Successful operations are evidence of
compatibility, not a 1,000-user capacity guarantee. Object duration and D1/R2
growth still need account-wide modeling; authenticated revert, mixed-history
Manual Sync and sanitized staging refresh remain release gates.
