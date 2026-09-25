# R2 storage capacity and retention decision (2026-09-25)

Status: **the archive design passes the 1,000-registered-account storage
sensitivity on an otherwise clean Cloudflare account, but this Cloudflare
account does not have Free R2 storage headroom.** Production archive activation,
object cleanup, billing changes and authentication cutover remain unapproved.

## Read-only inventory

Between **2026-09-25T13:28:32Z and 2026-09-25T13:29:26Z**, Wrangler 4.140.0
listed and classified every R2 bucket in the deployment account and reported
provider summaries. The account identifier, unrelated bucket names and their
exact object inventory are intentionally omitted from this public evidence.
The commands read bucket metadata only; they did not list keys or read object
contents. `r2 bucket info` selects the latest storage metric available within
its preceding 24-hour query window, so the provider samples may predate the
recorded UTC query interval.

| Bucket | Classification | Objects | Stored bytes shown by Wrangler |
| --- | --- | ---: | ---: |
| `linksim-avatars` | Production avatars | 10 | 1.41 MB |
| `linksim-avatars-staging` | Staging avatars | 4 | 6.53 MB |
| `linksim-history-staging` | Staging archive rehearsal objects | 5 | 824 kB |
| `linksim-terraform-state` | Terraform state; quota-sharing LinkSim operations | 2 | 51.5 kB |
| Other classified account buckets | Unrelated quota-sharing use; private inventory retained by operator | Not published | More than the 10 GB account allowance |

The four LinkSim buckets total approximately **8.82 MB**. Unrelated account use
alone is above the **10 GB** account allowance. Cloudflare's Standard R2 Free
allowance is account-wide and includes 10 GB-month of storage. A single
current-size snapshot does not establish the billing period's average daily
peak or whether the current month's allowance has already been consumed. It
does prove that retaining the current unrelated footprint is incompatible with
sustained Free-tier operation and that LinkSim cannot claim durable Free
headroom here. Provider summaries are rounded and may lag. This is an account
inventory, not an immutable object-by-object audit.

The production history bucket does not exist and production has no history R2
binding. Staging D1 contained 17,353 history rows, zero archive references and
zero partial references at measurement time. The five staging objects are
retained rehearsal or formerly referenced objects; absence from current D1 is
not permission to delete them. Production has no archive columns yet. Current
D1 sizes were 90,505,216 bytes in production and 50,618,368 bytes in staging.

Every LinkSim bucket has only Cloudflare's default rule to abort incomplete
multipart uploads after seven days. There is no expiry lifecycle or lock rule.
Do not add automatic expiry.

## Envelope-inclusive 1,000-account sensitivity

The current production aggregate contains 50 accounts, 13,268 history rows and
5,442 archive candidates. The candidate projection removes 69,447,073 bytes
from D1. Serializing the exact archive envelope shape used by
`historyArchive.ts` with SQLite `json_object()` produced 82,480,193 bytes across
the current candidates, with a 44,520-byte maximum object. The read-only query
read 13,268 rows and wrote none.

Linear multiplication by twenty is a sensitivity, not a forecast:

| Component | Bytes |
| --- | ---: |
| Production archive envelopes at 1,000/50 scale | 1,649,603,860 |
| Full separate staging copy | 1,649,603,860 |
| Current LinkSim avatars, rehearsal objects and state | about 8,815,500 |
| **Point sensitivity** | **about 3,308,023,220 (3.31 GB)** |

This supersedes the earlier 2.77 GB payload-only lower bound. It includes the
JSON envelope, a complete staging copy and current LinkSim R2 objects. It does
not establish future history growth, provider metadata bytes, failed-write
orphans, multiple retained immutable versions, or a future production bucket's
actual provider summary.

On an otherwise clean account, 3.31 GB uses about 33.1% of the 10 GB allowance.
Use **3 GB per history environment and 6 GB combined** as the pre-activation
operating caps. The current 1.65 GB-per-environment sensitivity fits beneath
that cap with about 1.35 GB (82%) growth room per environment. The combined cap
leaves about 4 GB for avatars, state, retained versions and other account use.
The existing maintenance code's 5 GB lifetime ceiling per environment is a
hard safety ceiling, not the operating target: two environments at that ceiling
would consume the allowance before avatars, state or retained orphans.

With the 6 GB combined cap, quota-sharing non-history use must stay below about
4 GB. Current unrelated use exceeds both that envelope and the entire 10 GB
allowance. The point sensitivity alone would fit only if all other account use
stayed below about 6.69 GB. The practical ways to restore a Free storage claim
are to move LinkSim to an independently administered Cloudflare account, reduce
or move the unrelated data, or accept R2 billing. No such change is authorized
here.

The candidate-count sensitivity is 108,840 immutable objects per environment,
217,680 with a full staging copy. Initial PUT volume remains below the one
million monthly Class A Free allowance if performed once in a month, but
verification reads, retries, refresh copies, normal use and orphan growth must
be measured during a real bounded rollout. Storage, Class A and Class B limits
are separate gates.

## Retention and cleanup contract

Archive keys are immutable retained versions. A failed or ambiguous D1 update
may leave an unreferenced object because deleting it could destroy a committed
reference. Restore deliberately clears the current D1 reference while retaining
the object for in-flight readers and database rollback. A D1 Time Travel or
backup restore can therefore make an older key live again.

There must be no automatic age-based bucket lifecycle. A future cleanup may
delete a key only through a separately reviewed operator action after all of
these checks pass:

1. A complete, environment-scoped inventory proves the key is absent from all
   current D1 archive references, with no partial references.
2. The object is older than the actual maximum D1 Time Travel and retained
   backup/export horizon plus an approved safety margin.
3. Every retained export or backup that could restore the key has expired, or a
   complete manifest proves the key is absent from each retained restore point.
4. No archive-maintenance lease, staging refresh, copy, restore, rollback or
   ambiguous write is active.
5. The listing is complete and every bucket, scope, object age and stored size
   is known. Unknown or partial data fails closed.

Current rehearsal objects do not satisfy those deletion proofs. The existing
archive, maintenance and staging-transfer code remains the source of truth for
copy, digest verification, compare-and-swap, leases and scoped keys. This phase
adds no garbage collector.

## Decision and release gates

The storage architecture receives a **qualified go for the 1,000 registered
account target** under the stated current-data sensitivity: 3.31 GB point use
and a 6 GB combined operational cap on an otherwise clean 10 GB account. There
is no defensible unconditional maximum because history is skewed and its future
growth rate is not measured.

The current account receives a **sustained Free-tier no-go** while unrelated use
remains above the 10 GB allowance. The current billing-period average was not
measured, so this is not a claim that the month's allowance has already been
consumed. It does not reduce the modeled LinkSim user target; it requires
account isolation, reduction of quota-sharing non-history data below about 4 GB
to preserve the 6 GB LinkSim cap, or explicit acceptance of R2 billing before
archive activation.

Before activation, re-run a complete account inventory and stop if any bucket
is unclassified, total LinkSim history would exceed 6 GB combined, either
environment would exceed 3 GB, or non-history account use leaves less than 4 GB
for the approved archive envelope. During rollout, record object/byte growth,
PUT/GET counts, retained-orphan counts, D1 references and physical D1 size after
each bounded batch. Pause maintenance and registration before either operating
cap or the accepted D1 envelope is crossed.

Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[R2 metrics](https://developers.cloudflare.com/r2/platform/metrics-analytics/),
[object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/),
[bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/),
[registered-account decision](2026-09-18-registered-capacity-decision.md), and
[representative physical storage](2026-09-18-representative-physical-storage.md).
