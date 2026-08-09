---
name: linksim-epic
description: Draft or revise a durable, multi-phase LinkSim epic as Steward without implementing or advancing it. Use when a broad objective needs a reuse inventory, explicit scope and non-goals, independently mergeable phases, acceptance gates, dependencies, risks, or a reviewable issue specification before development authorization.
---

# LinkSim Epic

Produce a signed proposal, not implementation. Follow `AGENTS.md`, inspect the
relevant issues and repository evidence, and read `docs/release-flow.md` when
the epic affects delivery, deployment, or release policy.

## Establish the objective

1. Restate the human objective without adding product behavior.
2. Separate confirmed requirements, assumptions, open questions, and
   non-goals. Ask before resolving an ambiguity that materially changes scope.
3. Search existing issues, code, UI, tests, scripts, workflows, and skills.
   Record what can be reused, adapted, consolidated, or removed.
4. Identify affected users, data, permissions, environments, and operations.

## Design independently mergeable phases

For each phase, define:

- outcome and boundaries;
- reused components and new work;
- dependencies and migration or compatibility concerns;
- tests and observable acceptance evidence;
- authority required and actions explicitly prohibited;
- rollback or safe stopping point.

Keep phases reviewable and useful on their own. Do not make a phase depend on
unmerged work when a stable interface can separate them. Put security,
authentication, data durability, budget, provenance, and release gates before
public autonomy.

## Control scope

- Pause when evidence changes the objective, a new dependency expands risk, or
  a proposed UI element lacks approval.
- Show the original scope, proposed change, reason, effects on completed and
  future phases, and the decision required.
- Never reinterpret an approval for one phase as approval for later phases.
- Never implement, merge, publish, close issues, or progress the epic
  automatically. An approved Forge task is required for implementation.

## Output

Return a compact issue-ready specification containing:

1. objective and success criteria;
2. confirmed scope, non-goals, assumptions, and open questions;
3. mandatory reuse and consolidation inventory;
4. phased delivery with acceptance and authority gates;
5. dependencies, risks, rollback points, and durable state;
6. decisions still requiring human approval.

End with `Suggestion only — no implementation authorized.` and
`— Steward · AI policy advisor`. Include valid provenance when publishing to
GitHub. Fail closed if attribution or provenance cannot be generated.
