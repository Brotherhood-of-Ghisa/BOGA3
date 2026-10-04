# M27-T08 — Define group percentage rules and wire contracts

- Status: `planned` (re-scoped 2026-10-04; old checkpoints are historical)
- Depends on: [M27-T15](M27-T15-Decide_percentage_reading_correction_policy.md)
- Milestone: [M27 — Bodyweight load and group comparisons](../milestones/M27-bodyweight-load-and-group-comparisons.md)
- Workstream: [#420](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/420)
- Areas: cross-stack; UI impact: yes (public metric semantics; presentation in T10)

## Objective and scope

Define a public percentage metric for bodyweight exercises and migrate its
server/client contracts without misleading old readers or exposing private
bodyweight. Milestone D2–D10 replace this card's old three-board, snapshot and
public-B/provenance requirements. No personal/sync schema redesign is requested.

## Decided and open definitions

The operator accepted `100 × effective estimated 1RM / B` (%BW) and retained
the group switch. Off ranks ordinary Volume/1RM; On with zero contribution
stays ordinary; On with positive contribution uses bodyweight-aware %BW 1RM.
Milestone D5 states the cross-mode/cross-group inference limit of ordinary Off
sharing. Never publish the private reading itself in either mode.

Record the operator's Volume answer from milestone D8 before implementation:
best single-set volume in both modes is proposed (kg·reps ordinary, %BW·reps
bodyweight-aware). A session aggregate requires explicit source window and
Certified-set eligibility. T15 settles private-reading correction behavior.

## Deliverables and acceptance

1. Inventory current `metric-contract.ts`, `metric-wire.ts`, wire guards, group
   RPCs, SQL tables/readers, evaluator and caches against current main. Positive
   group contribution, not a personal setting, identifies the bodyweight exercise.
2. Specify the accepted percentage metric identity, public unit, precision,
   deterministic ties, eligible sets and default. Add ordinary Volume (kg·reps)
   and retain ordinary 1RM (kg); implement the chosen normalized Volume policy. Never put percentages in a kg field or relabel persisted history.
   No absolute kg bodyweight alternative while On; no new reps board. Define
   legacy Weight/1RM certificate mapping without relabeling Weight as Volume
   or granting an aggregate a witness it never had.
3. Define the group switch's accepted interaction, including zero ↔ positive
   transitions and legacy writes. Preserve zero-contribution ready boards and
   no-op history. Rule changes can rescore, never cancel an unchanged witness.
4. Define a versioned additive/forward schema/RPC/decoder/cache transition.
   Preserve internal source facts and audit fields, but prevent public old/new
   RPCs from revealing private readings or enabled bodyweight absolute/relative
   counterparts in the same group. Ordinary Off results remain permitted. List every affected stream/session/detail/summary/history
   endpoint; T09 implements server projections/redaction.
5. Specify activation/minimum-client behavior so old clients neither display
   %BW as kg nor obtain disallowed data from legacy endpoints. Retire incompatible
   caches, including already-stored absolute/relative pairs. Fail closed for
   unsupported units without downgrading to an unsafe payload.
6. Preserve authorized member/role boundaries, OAuth/anonymous/outsider denial,
   coherent revision publication, immutable history and archived/former-member
   semantics. Historic kg payloads are not exempt from the new privacy boundary;
   redact disallowed kg fields while On and preserve server audit. Explicitly
   document that previously seen/other-group kg can still support inference.
7. Keep reading resolution server-only and as-of session start, with no new
   session snapshots or normal-sync group entities. Document T15's correction
   policy and the distinction between current score and immutable observed audit.
8. Graduate the delivered representation/compatibility contracts into owning
   specs; make activation truthfully planned until the scorer/readers/UI ship.

## Verification and closeout

Read test-directory READMEs. Add Jest unit/decoder vectors for category, metric
units, Volume aggregation, both switch modes, rounding, invalid payloads,
old/new versions and cache migration. Backend
contract tests prove actual SQL responses agree with decoders, permissions and
history/legacy non-disclosure. No UI redesign or new Maestro flow here.

## Specs to update

- `docs/specs/tech/groups-contract.md` — public units, reader privacy, revisions,
  certification metadata and version compatibility.
- `docs/specs/05-data-model.md`, `03-technical-architecture.md` — server-owned
  percentage projection and internal/public representation split.
- `docs/specs/tech/bodyweight-load-contract.md`, `training-metrics-contract.md`
  — private kg arithmetic versus public %BW group metrics.
- `docs/specs/10-api-authn-authz-guidelines.md` — changed group disclosure boundary.

## Gates

Run `./boga test for`, propose `fast`, `backend` and `ios-groups-e2e`, then run
what the operator agrees. Include `ios-sync-e2e` only if actual sync/auth paths
change; no such change is planned. Run required quality targets before PR.
Delete this card and mark the M27 row completed in the delivering PR; T14 owns
combined human acceptance, activation and final closeout.
