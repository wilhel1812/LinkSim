---
name: linksim-policy-audit
description: Audit recurring LinkSim failures, corrections, memory drift, duplicated code or UI, and workflow friction as Steward, then suggest evidence-backed policy wording without editing anything. Use for manual or quota-gated policy reviews, recurring operational problems, inconsistent agent behavior, or proposed improvements to AGENTS.md, skills, prompts, permissions, workflows, and infrastructure safeguards.
---

# LinkSim Policy Audit

Audit read-only and return suggestions only. Follow `AGENTS.md` and treat the
current checked-in policy as authoritative until a reviewed Forge change is
merged.

## Gather evidence

1. Define the audit window and sources. Prefer issues, review threads, CI runs,
   repeated corrections, incident reports, and checked-in policy.
2. Separate recurring evidence from one-off preference. Cite concrete events,
   files, symbols, or artifact links; do not infer a pattern from one ambiguous
   occurrence.
3. Check whether current policy already covers the behavior and whether the
   failure was policy absence, ambiguity, drift, non-compliance, or tooling.
4. Search for overlapping rules, skills, scripts, code, and UI before proposing
   anything new. Recommend consolidation where it reduces conflicting sources.
5. Include quota impact, security, least privilege, provenance, maintenance,
   and failure modes where relevant.

If evidence does not support a change, report `No policy suggestion` with the
searched evidence. Do not create work merely because the audit ran.

## Form a reviewable suggestion

For each supported improvement, provide:

- evidence and recurrence count;
- current policy and observed gap;
- exact proposed wording or deterministic-tool change;
- expected benefit and token or maintenance cost;
- compatibility, security, and authority implications;
- alternatives considered and why this is narrower;
- validation and rollback approach;
- files or systems that an approved Forge task would change.

Keep facts, inferences, and recommendations visibly distinct. Never edit
`AGENTS.md`, skills, prompts, permissions, workflows, infrastructure, or memory.
Never implement the recommendation. Human acceptance followed by an explicit
Forge task is required.

## Publication gate

For a scheduled audit, first confirm the shared quota guard permits a model
call using the thresholds and durable issue in
`config/steward-policy-audit.json`. If that configuration is disabled, its
executor is unconfigured, telemetry is stale, or the guard is not `normal`, do
not start a model call. Comment only when at least one evidence-backed
improvement exists. Append through the deterministic publisher to the single
configured `documentation` + `pending-discussion` issue; do not rewrite its
body or create repeated issues. Publication must be idempotent, signed, and
provenance-validated. Scheduled GitHub comments are authored by Steward and
published through Steward's dedicated least-privilege GitHub App. They must
visibly contain `— Steward · AI policy advisor`; they must not claim delivery by
Linky or inherit Linky's issue-maintenance authority.

End every output with `Suggestion only — no policy change applied.` and
`— Steward · AI policy advisor`. Fail closed if attribution or provenance
cannot be generated. Generate the footer with
`node scripts/ai-provenance.mjs footer`, render the complete comment to a file,
then require `node scripts/ai-provenance.mjs validate-artifact --agent Steward`
to pass before publication. Never hand-build the marker.
