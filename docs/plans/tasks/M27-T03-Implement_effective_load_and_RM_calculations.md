---
task_id: M27-T03-Implement_effective_load_and_RM_calculations
milestone_id: M27
status: planned
ui_impact: "no"
areas: "cross-stack"
runtimes: "node|deno"
gates_fast: "./boga test fast"
gates_slow: "./boga test groups-leaderboards; other lanes from ./boga test for"
docs_touched: "docs/specs/03-technical-architecture.md, docs/specs/tech/bodyweight-load-contract.md"
---

# M27-T03 — Implement effective load and RM calculations

- Status: `planned`
- Depends on: M27-T01.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: D1, D2, D5, D6, D8.

## Objective and scope

Provide one pure calculation boundary reusable by mobile, the coaching API and
the group evaluator. Read AGENTS.md, specs 02/03/05/09 and the bodyweight/groups
contracts. Refresh current call-site inventory and HEAD before implementation;
read test-directory READMEs. Do not ship only a helper while leaving consumers
silently using different semantics; T07/T09/T11 own their explicit adoption.

## Deliverables and acceptance

1. Resolve raw entered amount, added/assistance mode, exercise coefficient,
   load distribution and session B to effective resistance with an explicit
   known/missing/invalid result. `c=0` bypasses missing B. Keep entered external
   load available separately. Preserve parser/performed/warm-up semantics.
2. Calculate volume and total 1RM using existing Wathan helpers; calculate
   relative 1RM using the same session B in numerator and denominator.
   Provide aggregate completeness alongside any known subtotal.
3. Implement target-reps loading estimates with explicit total-versus-added
   results, target B, assistance for negative adjustment and a specified one-rep
   convention. Test forward/inverse consistency and rounding; do not replace
   Wathan or introduce hidden RIR corrections.
4. Normalize the body contribution exactly once. Apply muscle per-side/role
   factors after resistance resolution; conventional results remain identical.
5. Export pure typed inputs/results with no persistence, UI, platform or auth
   imports. Deno-reachable modules use the project's relative `.ts` import rule.
6. Define shared vectors that later consumers can use without duplicating the
   arithmetic in SQL. Group reps eligibility is independent of missing B.

## Required vectors

- B=80, c=1, A=0, reps=8 → L=80, volume=640, total 1RM ≈102.14.
- B=80, c=1, A=20, reps=8 → L=100, volume=800, total 1RM ≈127.67.
- B=80, c=.7, A=0, reps=15 → L=56, volume=840.
- B=80, c=1, H=20, reps=8 → L=60, volume=480.
- Source B=80 remains historical; target B=82 changes the loading projection.
- Conventional external-only rows match pre-change values, with B absent.
- Unknown B, invalid coefficients/units, zero/negative L, actual versus planned,
  high reps, warm-ups, comma/decimal parser policy and unsupported assistance.
- Equal-rep 60+20 versus 90+20 pull-ups reverse order between relative and
  absolute strength; unweighted relative scores are B-independent at fixed c.

## Verification and closeout

Run `./boga test fast` and `./boga test groups-leaderboards` because the group
Edge Function imports this calculation boundary. Use `./boga test for` for any
additional touched paths; run backend if the adapters/schema require it.
Publish numeric-vector evidence and contract changes in the PR, mark the
milestone entry complete and delete this card when shipped.
