# Corrected history compression CPU gate — 2026-09-17

**Gate failed. Keep Pages history compression disabled.** This rerun corrects
the fixture defect identified in PR #1114: slug and slugAliases now count
toward the record byte budget. A regression test sends both maximum-record
entropy variants through the actual production save function and verifies success.

Worker version: `fada60f8-6a9c-4712-b178-50edbce024a6`. All 56 authenticated requests matched
sanitized invocation records by order, path, status and client time window.
One separate anonymous request returned 404. All requests succeeded, but measured CPU exceeded the 10 ms gateway budget. This rerun supersedes the original fixture measurements.

| Fixture | Entropy | Mode | Samples | Mean CPU ms | Range ms | CPU failures |
|---|---|---|---:|---:|---:|---:|
| small | repetitive | baseline | 3 | 0.0 | 0–0 | 0 |
| small | repetitive | compress | 3 | 0.0 | 0–0 | 0 |
| small | varied | baseline | 3 | 0.0 | 0–0 | 0 |
| small | varied | compress | 3 | 0.3 | 0–1 | 0 |
| large | repetitive | baseline | 3 | 1.0 | 1–1 | 0 |
| large | repetitive | compress | 3 | 2.0 | 2–2 | 0 |
| large | varied | baseline | 3 | 1.3 | 1–2 | 0 |
| large | varied | compress | 3 | 7.3 | 7–8 | 0 |
| max-record | repetitive | baseline | 3 | 8.0 | 3–17 | 0 |
| max-record | repetitive | compress | 3 | 7.3 | 6–9 | 0 |
| max-record | varied | baseline | 3 | 3.7 | 3–4 | 0 |
| max-record | varied | compress | 3 | 28.3 | 24–34 | 0 |
| max-batch | repetitive | baseline | 5 | 34.0 | 26–43 | 0 |
| max-batch | repetitive | compress | 5 | 67.8 | 62–74 | 0 |
| max-batch | varied | baseline | 5 | 31.6 | 27–37 | 0 |
| max-batch | varied | compress | 5 | 153.2 | 116–204 | 0 |

CPU is runtime-reported milliseconds, not elapsed request time. Failed samples
include truncated execution; their CPU values cannot estimate cost to finish.
Zero is reported measurement resolution, not proof of no processing. Multiple
first-invocation markers occurred; they identify module instances, not guaranteed
infrastructure cold placement. Successful overruns do not demonstrate headroom.

The account was previously confirmed Free by the maintainer, not independently
queried during this run. The probe was removed after measurement and the local
ephemeral key deleted. No application setting, database or production deployment
changed. Full Manual Sync semantics and history remain intact.

Fixtures still represent synthetic component workloads, not a measured real-user
distribution. Baseline includes synthetic snapshot construction, validation,
serialization and byte accounting, not the exact production handler. Maximum
batch baseline cost warrants separate full-handler profiling; it does not prove
ordinary user sync fails. No authentication or 1,000-registered-user capacity
conclusion follows from this isolated history test.

Next design work must evaluate processing outside the Pages CPU budget or
reducing redundant storage while preserving exact history reconstruction. It
must measure decode/read costs, durability and full-request/free-tier costs;
do not silently move history work into the authentication Durable Object.

[Method](history-runtime.md) · [Corrected evidence](history-runtime-corrected-2026-09-17.json) · [Original run and limitation](history-runtime-results-2026-09-17.md)
