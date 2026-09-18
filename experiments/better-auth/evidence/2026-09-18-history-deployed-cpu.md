# Deployed staging history archive CPU and retention

Issue #1107; 2026-09-18. A disposable, randomly named Worker and Durable
Object ran on Cloudflare with **staging** D1 and private R2 bindings. It was
restricted to synthetic `resource_changes.id=9202`, Simulation
`archive-rehearsal-sim-1107-20260918`, and actor
`archive-rehearsal-user-1107-20260918`. Its gateway and object required the
same private 256-bit secret and expired after 20 minutes. The Worker was
deleted after the run. No production resource or real user's history was
changed. No raw tail or secret is retained in this evidence. The exact
sanitized [invocation tail](2026-09-18-history-deployed-tail.jsonl) and
[operation results](2026-09-18-history-deployed-results.jsonl) are retained
for review; the latter contains only counts and the synthetic row comparison.

| Operation | Verified HTTP | CLI elapsed | D1 queries / read / written | R2 put / get / list | Two invocation CPU values (ms) |
|---|---:|---:|---:|---:|---:|
| Object count before | 200 | 1,209 ms | 1 / 1 / 0 | 0 / 0 / 1 | 1 + 3 |
| Dry run | 200 | 159 ms | 2 / 2 / 0 | 0 / 0 / 0 | 1 + 2 |
| Archive | 200 | 1,075 ms | 3 / 3 / 2 | 1 / 1 / 0 | 1 + 6 |
| Hydrate | 200 | 292 ms | 2 / 2 / 0 | 0 / 1 / 0 | 0 + 2 |
| Restore | 200 | 372 ms | 3 / 3 / 2 | 0 / 1 / 0 | 0 + 3 |
| Object count after | 200 | 382 ms | 1 / 1 / 0 | 0 / 0 / 1 | 1 + 1 |

The sanitized Cloudflare tail recorded **two invocations per operation**,
both `200/ok`, under the same deployed script version. The tail does not label
gateway versus object, so the table gives the two values without assigning
them. No individual invocation exceeded **6 ms CPU**, and the archive pair
used **7 ms combined CPU**. CPU is distinct from wall time and client elapsed
time. This one small synthetic history row is an initial deployed runtime
check, not a throughput or large-record guarantee.

R2 `list` found **one** object under this row's staging prefix before the run,
confirming retention from the earlier local-DO/remote-R2 rehearsal. It found
**two** after this archive and restore. Both objects remain private and are
intentionally retained because D1 backups or Time Travel may reference them.
The archived row projected 4,285 bytes to 163 D1 bytes; hydration returned
4,285 bytes. After restore, D1 `snapshot_json` was 4,285 bytes and exactly
equaled the synthetic Simulation's `payload_json`; both archive reference
columns were null. D1 size returned to 30,420,992 bytes.

This closes the missing **deployed CPU and R2-retention probe for one synthetic
row**. The archive writer is still not enabled in the application. Remaining
gates include representative large-record CPU and cost measurements, live
authenticated revert, Manual Sync with mixed archived and inline history,
sanitized staging refresh, and a capacity model for 1,000 registered users.
