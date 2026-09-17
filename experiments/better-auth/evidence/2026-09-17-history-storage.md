# Lossless history details: compatibility evidence, not capacity approval

Base: staging `4462e33bcbab29bccb366d0c83ccef86c4b5d5c0`; version remains 0.29.0.

## Live aggregate evidence (read-only)

Production: 50 user rows, 362 Sites, 103 active Simulations, 6 deleted Simulations,
13,149 history entries. History snapshots occupy 35,274,286 payload bytes and
change details 45,031,209 bytes. Of those detail bytes, 43,270,753 occur in
`diff.snapshot` before/after values. All 4,489 such after values matched the
row snapshot and all before values matched the preceding resource snapshot.
No user content was exported; only aggregate counts and byte lengths were read.

Cross-row references were rejected: identity reconciliation rewrites historical
snapshots. A self-contained archive preserves the original audit details even
when a snapshot is later reconciled, and avoids chains of dependent rows.

## Implemented format and compatibility

`historyDetails.ts` uses the platform's gzip CompressionStream, with no new
library. Only details containing a bulky `diff.snapshot` are candidates. A
versioned envelope contains the complete original UTF-8 JSON, compressed and
base64 encoded. The ordinary JSON projection retains every existing field except
`diff.snapshot`, including name/status/visibility, previous grants, changed-field
names and revert provenance. Existing SQL indexes and history response allowlists
continue to work without decompression. Snapshots are unchanged; revert, ownership,
full Manual Sync, deletion and revocation queries remain on their existing paths.

Decode restores the exact original JSON text, with bounded expansion and strict
format validation. Small, malformed, already encoded, oversized, and non-beneficial
records remain unchanged. The archive is not exposed in public history responses.

New writes require explicit `HISTORY_DETAILS_COMPRESSION=gzip-v1`; **no checked-in
environment enables it**. Default production and staging behavior stays legacy
until remote CPU validation. This is an inactive integration, not a storage cutover.

`compactHistoryDetailsPage` is an internal maintenance primitive, not an API or
scheduled task. It defaults to dry-run and reads at most 10 rows by primary key.
It verifies each candidate's exact round trip before conditional per-row updates.
The update compares the original details text; concurrent changes are reported as
conflicts and never overwritten. A later rescan is required for conflicts. Errors
stop the page; already converted rows remain valid, and rerunning is idempotent.
The helper neither downloads a database nor performs production conversion.

## Reproduce locally

Run `node experiments/better-auth/history-storage.mjs`. It creates disposable
local workerd/D1, rejects outbound fetches, tests the real codec, checks SQL
permission extraction, dry-run, apply and repeated apply, and closes the runtime.
Fixtures are synthetic; no external credentials or database bindings are used.

| Synthetic Sites per snapshot | Original details | Stored details | Snapshot JSON | Snapshot gzip |
|---|---:|---:|---:|---:|
| 12 | 3,261 B | 798 B | 1,515 B | 258 B |
| 100 | 25,757 B | 2,199 B | 12,763 B | 1,141 B |
| 400 | 103,625 B | 12,016 B | 51,697 B | 4,417 B |

All exact round trips passed. Local detail encode/decode wall durations were
2/1/4 ms respectively. These are **not billed CPU measurements** and cannot
establish the 10 ms gateway gate. One sample per fixture is compatibility evidence,
not a latency distribution. Standalone snapshot gzip is an experiment only; no
snapshot storage or reader is changed.

## Remaining gates and rollout

1. Measure cold/warm remote gateway CPU, maximum permitted payloads and full
   upload batches before enabling the write flag. If gateway CPU fails, move the
   work to an appropriate runtime; do not rely on successful overruns.
2. Rehearse mixed old/compact histories and compare complete recovery/revert,
   grants, identity reconciliation and audit results on synthetic staging data.
3. Obtain a production conversion decision separately. Use a verified backup,
   bounded pages, retry conflicts, and budget index-write amplification. Storage
   payload savings do not guarantee immediate shrinkage of allocated SQLite pages.
4. Reassess the 1,000 registered-account budget. Details compression alone does
   not prove long-term storage capacity; snapshot compression needs its own
   queryable metadata design, measurements and approval before integration.

Rollback: disable the write flag. Existing consumers can read the clear projection
and unchanged snapshots. Keep the decoder for full audit export; never remove the
compressed archive or bulk rewrite it without round-trip verification. No rows,
revert points, or permission evidence are pruned in this batch.
