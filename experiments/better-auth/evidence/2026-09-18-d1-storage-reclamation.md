# D1 storage-reclamation check (2026-09-18)

This is an aggregate-only capacity observation for issue #1107, **not** archive
activation or proof of 1,000-account capacity. The production queries below
were read-only. The write experiment used a separately created, synthetic
`linksim-d1-storage-probe-1107` database (UUID
`f8c8699c-cc2b-43d6-9145-68b4233024a3`) in WEUR, never an application
binding. Wrangler deleted that database after the measurements, and a D1 list
confirmed its absence. The application and its staging/production databases were
not modified.

## Production snapshot

The production D1 `size_after` was **90,234,880 bytes**. Aggregate SQL counted
50 registered users, 362 Sites, 109 Simulations, and 13,149 resource history revisions. History
`snapshot_json` plus `details_json` contained **80,305,495 UTF-8 bytes**;
current Site and Simulation payloads contained 271,416 and 383,282 bytes,
respectively. An aggregate projection using `json_remove` and
`length(CAST(... AS BLOB))` identified 5,426 of 6,465 Simulation revisions
whose removable JSON was at least 2,048 bytes, totaling **69,348,172
potentially removable bytes**; none of 6,684 Site revisions qualified. These
are approximate logical payload bytes, not a physical database shrinkage
prediction, and are a dated snapshot. The aggregate queries read rows and
wrote zero; they returned no content or user identifiers.

The exact read-only SQL ran as separate `wrangler d1 execute linksim
--remote --command <SQL> --json --config wrangler.toml` calls. It uses a BLOB
cast to count UTF-8 bytes. Repeating it consumes reads and observes a later
database state:

```sql
SELECT
  (SELECT COUNT(*) FROM users) AS registered_users,
  (SELECT COUNT(*) FROM sites) AS sites,
  (SELECT SUM(length(CAST(payload_json AS BLOB))) FROM sites) AS site_payload_bytes,
  (SELECT COUNT(*) FROM simulations) AS simulations,
  (SELECT SUM(length(CAST(payload_json AS BLOB))) FROM simulations) AS simulation_payload_bytes,
  (SELECT COUNT(*) FROM resource_changes) AS revisions,
  (SELECT SUM(length(CAST(COALESCE(snapshot_json,'') AS BLOB))
            + length(CAST(COALESCE(details_json,'') AS BLOB)))
     FROM resource_changes) AS history_payload_bytes;

WITH sizes AS (
  SELECT resource_kind,
    length(CAST(COALESCE(snapshot_json,'') AS BLOB))
      + length(CAST(COALESCE(details_json,'') AS BLOB)) AS before_bytes,
    (CASE WHEN json_valid(snapshot_json) THEN
       length(CAST(snapshot_json AS BLOB))
         - length(CAST(json_remove(snapshot_json,'$.snapshot') AS BLOB))
     ELSE 0 END
     + CASE WHEN json_valid(details_json) THEN
       length(CAST(details_json AS BLOB))
         - length(CAST(json_remove(details_json,'$.diff.snapshot') AS BLOB))
     ELSE 0 END) AS removed_bytes
  FROM resource_changes
)
SELECT resource_kind, COUNT(*) AS revisions,
  SUM(CASE WHEN removed_bytes>=2048 THEN 1 ELSE 0 END) AS candidate_rows,
  SUM(CASE WHEN removed_bytes>=2048 THEN removed_bytes ELSE 0 END)
    AS candidate_removed_bytes
FROM sizes GROUP BY resource_kind;
```

The first result was `(50, 362, 271416, 109, 383282, 13149, 80305495)`
in selected-column order: 27,290 rows read, zero written, one attempt,
`size_after=90234880`. The second returned `(simulation, 6465, 5426,
69348172)` and `(site, 6684, 0, 0)`: 13,149 rows read, zero written, one
attempt, same `size_after`. No account data was selected.

A third read-only aggregate grouped history by the owner field in the
snapshot, returning **only distribution statistics**; this owner grouping is
not an account count:

```sql
WITH sizes AS (
  SELECT COALESCE(CASE WHEN json_valid(snapshot_json)
    THEN json_extract(snapshot_json,'$.ownerUserId') END,'unknown') AS owner,
    length(CAST(COALESCE(snapshot_json,'') AS BLOB))
      + length(CAST(COALESCE(details_json,'') AS BLOB)) AS before_bytes,
    (CASE WHEN json_valid(snapshot_json) THEN
       length(CAST(snapshot_json AS BLOB))
         - length(CAST(json_remove(snapshot_json,'$.snapshot') AS BLOB))
     ELSE 0 END
     + CASE WHEN json_valid(details_json) THEN
       length(CAST(details_json AS BLOB))
         - length(CAST(json_remove(details_json,'$.diff.snapshot') AS BLOB))
     ELSE 0 END) AS removed_bytes
  FROM resource_changes
), per_owner AS (
  SELECT owner, COUNT(*) AS revisions,
    SUM(before_bytes) AS history_bytes,
    SUM(before_bytes - CASE WHEN removed_bytes>=2048
      THEN removed_bytes ELSE 0 END) AS projected_bytes,
    SUM(CASE WHEN removed_bytes>=2048 THEN 1 ELSE 0 END) AS candidate_rows
  FROM sizes GROUP BY owner
), ranked AS (
  SELECT revisions, history_bytes, projected_bytes, candidate_rows,
    ROW_NUMBER() OVER (ORDER BY history_bytes) AS rn,
    COUNT(*) OVER () AS owners FROM per_owner
)
SELECT MAX(owners) AS owner_groups, SUM(revisions) AS revisions,
  SUM(history_bytes) AS history_bytes,
  SUM(projected_bytes) AS projected_bytes,
  MAX(history_bytes) AS largest_history_bytes,
  MAX(projected_bytes) AS largest_projected_bytes,
  MAX(CASE WHEN rn=(owners+1)/2 THEN history_bytes END)
    AS median_history_bytes,
  MAX(CASE WHEN rn=(owners*9+9)/10 THEN history_bytes END)
    AS p90_history_bytes,
  ROUND(100.0*MAX(history_bytes)/SUM(history_bytes),1)
    AS largest_history_percent FROM ranked;
```

It returned 42 owner groups, 13,149 revisions, 80,305,495 original and
10,957,323 projected history bytes; the median owner group held 135,315
original bytes, the 90th percentile 4,114,434, and the largest 20,363,178
(25.4% of total). The largest projected owner group was 3,916,203 bytes.
D1 reported 26,510 rows read, zero written, one attempt, and
`size_after=90234880`. This skew makes a straight per-user extrapolation
especially unreliable. The projection does not include R2 envelopes or
fully account for SQLite/index overhead.

## Disposable database

Loaded the repository's `db/schema.sql` with its JSON expression and partial
history indexes, then added the prototype's `archive_key` and `archive_digest`
columns. The first synthetic set inserted 100 private Simulation revisions,
each with randomized hex padding inside `snapshot` and `details.diff.snapshot`.
The subsequent SQL update matched the prototype's projected JSON fields:

```sql
UPDATE resource_changes
SET snapshot_json = json_remove(snapshot_json, '$.snapshot'),
    details_json = json_remove(details_json, '$.diff.snapshot'),
    archive_key = 'history-prototype/synthetic-staging/' || id || '/synthetic',
    archive_digest = lower(hex(randomblob(32)))
WHERE resource_kind = 'simulation' AND archive_key IS NULL;
```

The reference and digest values here are **synthetic markers, not recoverable
R2 objects**. This SQL isolates D1 file-size behavior. The separate archive
prototype tests establish R2 write/verification and exact restore behavior;
neither probe authorizes this SQL as an application migration.

| Step | Revisions | D1 `size_after` | Payload bytes in D1 | D1 write rows |
| --- | ---: | ---: | ---: | ---: |
| Empty application schema | 0 | 180,224 | 0 | — |
| Insert 100 large revisions | 100 | 8,458,240 | 8,209,492 | 501 |
| Compact all 100 | 100 | 266,240 | — | 200 |
| Verify row content/metadata | 100 | 258,048 | 11,592 | 0 |
| Add 25 large public/private revisions | 125 | 2,318,336 | — | 138 |
| Compact 12 of those 25 | 125 | 1,335,296 | — | 30 |
| Verify the mixed set | 125 | 1,335,296 | 1,080,232 | 0 |

All 125 rows retained the synthetic owner in indexed JSON metadata. At the
last step, 112 had archive markers and 13 retained full payloads. Thus, in
this fresh remote D1 database, updating large indexed JSON to a compact
projection **did reduce the reported physical database size** without an
explicit `VACUUM`; the mixed case did not require all rows to be compacted.
It does not establish how an older populated production database behaves,
whether size reclamation is immediate for every page layout, or how retention,
backups, auth tables, later growth, and real activity affect headroom.

`PRAGMA page_count`, `freelist_count`, and `auto_vacuum` were rejected with
`SQLITE_AUTH`; only D1's `size_after` was used. A two-statement attempt to
insert 50 Simulations plus ten Site tombstones returned `D1_RESET_DO`; the
scratch Site statement also used `action='deleted'`, which violates the
application table's `created`/`updated` check. Its cause cannot be assigned
to the reset alone. A subsequent aggregate confirmed it committed no rows.
A bounded 25-row
single-statement insert then succeeded. Do not treat the failed import as a
successful mixed-Site measurement.

Cloudflare currently lists [500 MB per database on Workers Free](https://developers.cloudflare.com/d1/platform/limits/).
Simple 20× extrapolation from this 50-account snapshot would exceed that
ceiling, but the existing users' activity and history sizes are skewed and do
not justify a linear forecast. Even a 20× projection after subtracting the
69.3 MB logical archive estimate would leave little room for ongoing history,
auth tables, and indexes. The 1,000 **registered** account goal therefore
still needs a bounded growth/retention model, account-wide quota baseline,
real archive-aware export/revert integration, and staging rehearsal before the
authentication capacity gate can pass. No change to the accepted D1-write
sensitivity or the production approval boundary is implied.
