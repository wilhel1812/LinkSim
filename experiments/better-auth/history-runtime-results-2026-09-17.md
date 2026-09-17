# Remote history compression result — 2026-09-17

**Gate failed: keep application history compression disabled.** This is a
synthetic Worker component measurement, not an authentication or full Library
benchmark. It does not revise the target of 1,000 registered accounts.

Measured Worker version: `4063559c-c14f-4ca9-8bf8-0ba4d6e13471`. Account was
previously confirmed Free by the maintainer; billing plan was not independently
queried during this run. Measurements ran 12:15:14–12:15:25 UTC. The disposable
Worker was deleted after collection and its local ephemeral key removed.

All 56 authenticated requests have matching sanitized invocation records, matched
by sequential order, path, HTTP status and timestamp within the client request
window. One separate anonymous request returned 404. Eight authenticated requests
returned 503 with `exceededCpu`: five compressed and three baseline requests.
CPU values below come from Wrangler invocation `cpuTime`, in milliseconds,
not client latency. Failed requests are included; terminated measurements are
truncated work and must not be interpreted as the CPU required to finish.

| Fixture | Entropy | Mode | Samples | Mean CPU ms | Range ms | CPU failures |
|---|---|---|---:|---:|---:|---:|
| small | repetitive | baseline | 3 | 0.0 | 0–0 | 0 |
| small | repetitive | compress | 3 | 1.0 | 1–1 | 0 |
| small | varied | baseline | 3 | 0.7 | 0–1 | 0 |
| small | varied | compress | 3 | 1.0 | 1–1 | 0 |
| large | repetitive | baseline | 3 | 2.7 | 2–4 | 0 |
| large | repetitive | compress | 3 | 3.3 | 3–4 | 0 |
| large | varied | baseline | 3 | 1.3 | 1–2 | 0 |
| large | varied | compress | 3 | 11.0 | 7–17 | 0 |
| max-record | repetitive | baseline | 3 | 6.7 | 5–9 | 0 |
| max-record | repetitive | compress | 3 | 11.0 | 10–12 | 2 |
| max-record | varied | baseline | 3 | 8.3 | 6–10 | 1 |
| max-record | varied | compress | 3 | 10.0 | 10–10 | 3 |
| max-batch | repetitive | baseline | 5 | 48.8 | 20–71 | 2 |
| max-batch | repetitive | compress | 5 | 113.2 | 103–132 | 0 |
| max-batch | varied | baseline | 5 | 48.6 | 42–64 | 0 |
| max-batch | varied | compress | 5 | 235.2 | 190–270 | 0 |

Small is 4 KiB, large 64 KiB, max-record 256 KiB; max-batch is 20 records
in a 2,096,940-byte request. Compressed maximum batches reduced details from
4,190,560 bytes to 180,660 bytes (repetitive) or 2,503,632 bytes (varied).
That storage benefit does not compensate for insufficient gateway CPU headroom.

The first authorized invocation was varied max-batch compression: 260 ms CPU.
It marks module initialization, not proven infrastructure cold placement. Later
successful requests also exceeded 10 ms; success alone is not a capacity pass.
A zero is the runtime-reported value at its measurement resolution, not proof
of no processing.

Baseline includes synthetic before/after construction, validation, serialization
and byte accounting; it is not an exact production handler profile. Its maximum
batch failures identify a separate large-payload risk worth measuring in the
real application. They do not prove ordinary user sync currently fails.

## Decision and next scope

Do not enable `HISTORY_DETAILS_COMPRESSION=gzip-v1` in Pages. Preserve full
Manual Sync semantics and existing history. Investigate moving bounded history
compression outside the Pages request CPU budget, or eliminating redundant
history storage while preserving exact reconstruction and authorization. Either
requires a separately reviewed design and measurements of decode/read costs,
durability, D1/storage costs and full request overhead before activation. Do not
silently add this work to the authentication Durable Object.

See [probe method](history-runtime.md) and [sanitized measurements](history-runtime-results-2026-09-17.json).
No application configuration, production database, retention policy or auth
deployment changed during this experiment.
