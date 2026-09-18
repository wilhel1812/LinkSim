# Bounded staging archive rehearsal

This is a temporary operator probe for issue #1107. It does not enable automatic
archive writes or add an application route. It runs a local Worker and Durable
Object with remote bindings to **only** `linksim_staging` and
`linksim-history-staging`. The checked-in generator rejects a changed D1 ID,
bucket name, non-synthetic actor/resource ID, or expiry beyond 30 minutes.
The archive scan and conditional D1 update both require the exact selected row
ID and actor/resource identity; a deleted fixture cannot advance into another
user's history.
The gateway and object both require the generated 256-bit secret. The secret is
stored only in an ignored, mode-0600 `.dev.vars` beside the generated Wrangler
config; never paste it into an issue, PR, log, or shell argument. Stop the local
development process and run `cleanup` after the rehearsal.

Use a disposable, private staging-only user/Simulation/history fixture. No real
user history is eligible. Record the fixture's history ID from a metadata-only
D1 query, then prepare the exact ID, kind, resource ID and actor ID:

```sh
node experiments/better-auth/prepare-history-archive-staging.mjs prepare ROW_ID simulation archive-rehearsal-SIM_ID archive-rehearsal-USER_ID
npx wrangler dev --config experiments/better-auth/.wrangler/history-staging-rehearsal/wrangler.json --port 8799
```

In a second terminal, invoke one operation at a time. `dry-run` scans the one
row without writing. `archive` writes one immutable R2 object, verifies it,
then conditionally replaces the bulky D1 fields. `hydrate` checks integrity
without returning content. `restore` puts the original fields back in D1; the
immutable R2 object remains for Time Travel and in-flight readers.

```sh
node experiments/better-auth/prepare-history-archive-staging.mjs call dry-run
node experiments/better-auth/prepare-history-archive-staging.mjs call archive
node experiments/better-auth/prepare-history-archive-staging.mjs call hydrate
node experiments/better-auth/prepare-history-archive-staging.mjs call restore
node experiments/better-auth/prepare-history-archive-staging.mjs cleanup
```

Record status, elapsed time, D1 rows read/written and R2 operations from the
sanitized responses. The Durable Object runs locally while D1/R2 bindings
connect to staging, so these wall times do **not** prove deployed CPU headroom.
The fully remote Wrangler preview returned 503 for the SQLite-backed object;
CPU must be measured separately through a deployed, reviewed runtime before
claiming the release gate. Verify D1 `archive_key` and
`archive_digest` are non-null only between archive and restore, and compare
the original snapshot/details exactly. Run the current staging sanitized-export
and Manual Sync verification separately; this synthetic account cannot test
an authenticated application revert. The existing local integration suite
covers authorized revert. A later staging test with a maintainer-owned test
Simulation is still required for that end-to-end path.

The rehearsal has no delete endpoint. Do not delete an R2 object referenced by
D1 or by a possible D1 backup/Time Travel state. A failed or ambiguous archive
response must be checked in D1 and retried only after reconciling the reference.
