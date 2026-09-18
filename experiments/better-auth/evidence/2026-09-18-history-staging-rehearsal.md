# Synthetic staging history archive rehearsal

Issue #1107; 2026-09-18. This is one synthetic row in the real staging D1 and
private history bucket. No production resource or real user history was changed.
The reviewed local Durable Object ran with **remote staging D1/R2 bindings**.
Cloudflare's fully remote Wrangler preview returned 503 for the SQLite-backed
object, so these elapsed times are **not deployed CPU measurements**.

The isolated fixture was `resource_changes.id=9202`, Simulation
`archive-rehearsal-sim-1107-20260918`, actor
`archive-rehearsal-user-1107-20260918`. The original `snapshot_json` was 4,285
bytes and exactly equaled the synthetic Simulation's payload. The operation
was constrained to that ID, resource and actor at selection and D1 update;
independent review found and resolved a cross-row race before the live write.

| Operation | HTTP | Elapsed | D1 queries | Rows read | Rows written | R2 put/get | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| Dry run | 200 | 483 ms | 2 | 2 | 0 | 0/0 | 1 candidate, 0 converted |
| Archive | 200 | 1,046 ms | 3 | 3 | 2 | 1/1 | 1 converted, 0 conflicts |
| Hydrate | 200 | 714 ms | 2 | 2 | 0 | 0/1 | Original 4,285 bytes recovered |
| Restore | 200 | 592 ms | 3 | 3 | 2 | 0/1 | Restored |

After archive, the D1 projection was 163 bytes, with a staging-scoped R2 key
and a digest. The D1 reported size moved from 30,420,992 bytes after fixture
creation to 30,416,896 after archive, then back to 30,420,992 after restore.
After restore, `snapshot_json` again exactly matched the original Simulation
payload; both archive reference columns were null. The object code never
deletes R2 data. The R2 bucket summary still reported `0 objects / 0 B`
immediately after the run, so its delayed metrics could not establish
retention at that point. A later deployed [R2 list probe](2026-09-18-history-deployed-cpu.md)
found the object under this row's staging prefix before a second archive run.
No object cleanup will be attempted until backup/Time Travel retention is designed.

This rehearsal does not satisfy deployed CPU headroom, a live authorized
application revert, a live sanitized staging refresh, Manual Sync on a mixed
archived/inline account, or 1,000-registered-user capacity. The existing
automated integration tests cover archive-aware authorization/revert and
staging-export replacement, and full 1,524 tests plus build passed on the
reviewed exact-row fix before this rehearsal. Archive writes remain disabled
in the application.
