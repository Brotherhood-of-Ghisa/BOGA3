# M27 — Bodyweight load and group comparisons

- Milestone ID: `M27`
- Status: `in_progress` (reconciled group follow-up tasks are `planned`)
- Created: 2026-09-25; reconciled: 2026-10-04
- Planning baseline: `b997e2f4` on `origin/main`
- Workstream: [#420 — Stabilize group metric rebuilds and certifications](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/420)
- Child issues: [#411](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/411), [#419](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/419)

## Objective and active scope

Preserve witness certifications across calculation-rule changes, avoid rebuilds
that cannot affect scores, and compare bodyweight exercises in bodyweight
percentage terms without disclosing a member's private bodyweight.

The user confirmed two product decisions on 2026-10-04: rule changes do not
invalidate certifications; a positive **group exercise contribution** identifies
a bodyweight exercise whose competitive strength results use bodyweight
percentages when the group switch is On. Off uses ordinary Volume and 1RM
rankings, as the user clarified in the same session. The current kg-only group wire contract and rule-sensitive
certification pins do not yet satisfy this target. This is an implementation
plan, not a claim that the target is shipped.

This consolidation replaces the old group requirements in this milestone and
T08–T10. Their revised scope is planned, regardless of historical implementation
checkpoints. Original personal work (T01–T07/T11) is historical context, not a
request to restore snapshots, backfill, assistance modes or three-board group
UI. The original T12 closeout is replaced for this workstream by T14; do not run
its obsolete acceptance scenario. Preserve those cards until their separate
lifecycle is resolved; do not claim them completed from this planning change.

## Governing references

- `AGENTS.md`; `docs/plans/README.md` task protocol: one task/session/worktree/PR.
- `docs/specs/02-quality-and-test-gates.md`, `03-technical-architecture.md`,
  `05-data-model.md`, `09-project-structure.md`, `10-api-authn-authz-guidelines.md`.
- `docs/specs/tech/groups-contract.md`, `tech/bodyweight-load-contract.md`,
  `tech/training-metrics-contract.md`, `tech/sync-v2-server-contract.md`.
- `docs/specs/08-ux-delivery-standard.md`, `ui/README.md`,
  `ui/ai-design-policy.md`, `ui/design-targets/groups.md`.

These specs describe current production contracts. Implementation tasks update
the owning specs when behavior ships; this planning PR does not mislabel the
new target as already implemented.

## Agreed behavior

### D1. Raw performance versus derived results

Sets retain their logged values and performed state. Group calculations consume
raw facts through the shared TypeScript kernel; never rewrite logged kg values
into percentages or store a personal achievement as source data.

### D2. Exercise identity

The group's `bodyweight_contribution` fraction, not the member's personal
contribution, name or bodyweight, selects its scoring category. `c = 0` is a
conventional exercise; `c > 0` is a bodyweight exercise. Linking copies no
private preference or contribution. Owners/admins control group rules. Keep the
group On/Off switch: bodyweight-aware scoring is active only when On and c > 0;
Off ignores contributions/readings and uses ordinary calculations.

### D3. Private dated bodyweight

Use the latest valid, nondeleted private reading at or before the exact session
start, with the current contract's deterministic tie rule. No frozen session
snapshot, session bodyweight editor, future-reading fallback or new sync entity
is introduced. Missing/invalid private input never becomes zero for a
bodyweight-dependent group score. Public copy must not expose why a private
input was unavailable.

### D4. Reading corrections remain separate

Reading value/date/delete/restore changes are calculation-data corrections,
not rule edits. Preserve existing test outcomes until a separate decision is
made: a relevant correction voids the existing e1RM certificate, while the raw
Weight certificate remains active; irrelevant/later readings have no effect.
T15 must settle the new percentage metric's correction policy before its
implementation. The user has not yet extended the rule-only guarantee to
reading corrections.

### D5. Privacy across every group surface

In an enabled positive-contribution comparison, other members receive normalized
percentage results and permitted public set context (identity, reps, performed
status, date and certification state). Never disclose bodyweight kg, private
reading identity/date/provenance, dependency digests or an absolute kg counterpart
alongside that comparison's percentage.

Audit board/podium/detail/history/event/stream/session/summary/legacy RPCs and
cache paths, including View full session from a record. For enabled bodyweight
results, suppress raw added-load kg, absolute effective 1RM and aggregate absolute
load/volume that permits subtraction to recover the private contribution. Redact
old kg audit/history fields from these group responses and evict incompatible
caches when switching On. Keep original audit facts server-side. Owner-private
workout/coaching views retain their existing kg access.

Off and zero-contribution comparisons intentionally expose ordinary Volume and
1RM results. The private reading itself stays undisclosed and unused while Off.
This choice limits the privacy claim: a member who has retained ordinary kg
scores while Off, sees equivalent kg in another group, or knows the external
plates can correlate them with a later %BW result and infer bodyweight. Cache/
history redaction cannot undo values already seen. The requirement is direct
reading non-disclosure and safe enabled-group responses, not a guarantee against
cross-mode, cross-group or external inference. A stronger guarantee would require
a different sharing policy; do not promise it while retaining ordinary Off mode.

### D6. Calculation and units

Reuse the existing effective-load, distribution and 1RM mathematics. Do not
change the Wathan model, multiply bodyweight twice or round before ranking.
Percentage is a separate public unit/representation, never a mislabeled kg
value. Normalization must use the same dated reading as the numerator.

### D7. Rule publication and history

Effective scoring-rule changes rebuild affected comparisons under one coherent
revision and recompute eligible Certified and All entries. While rebuilding,
serve the existing explicit state without mixed-revision rows. A recalculation
is a rules event, not a newly performed PR. Retain history; historic events keep
their original metric, unit and revision. Do not relabel old kg values as %BW.

Zero-contribution comparisons must stay ready across legacy group preference
toggles, preserving scores, revision, history and certificates. The [existing
#411 task](../tasks/T-20260930-01-Keep_zero_contribution_group_boards_stable.md)
owns this no-op behavior. A contribution change between zero and positive is
an effective rule/representation change and needs coherent publication.

### D8. Competition modes and percentage formula

The operator confirmed `100 × effective estimated 1RM / B`, displayed as `%BW`.
B is the private dated reading from D3. For example, internal effective estimated
1RM = 100 kg and B = 80 kg gives public `125% BW`; neither kg input accompanies
that enabled bodyweight score. This is effective 1RM, not added load % alone.

| Group switch | Group contribution | Competitive results |
| --- | --- | --- |
| Off | Zero or positive | Ordinary Volume (kg·reps) and ordinary 1RM (kg), without bodyweight contribution or reading access |
| On | Zero | Ordinary Volume (kg·reps) and ordinary 1RM (kg); no private-reading dependency |
| On | Positive | Bodyweight-aware 1RM (%BW), using the group's contribution and private dated B; no absolute-kg alternative in this mode |

The user explicitly retained the switch and chose ordinary Volume/1RM while Off.
Switching On/Off for positive contribution is an effective scoring change and
rebuilds coherently while preserving unchanged-set certificates. Zero contribution
is a no-op. Existing raw Weight metrics/certificates require an explicit legacy
mapping/compatibility policy in T08; do not relabel a Weight value as Volume or
silently treat its certificate as a different witnessed aggregate.

Volume is new ranking work, not a claim that today's Weight board already means
Volume. Proposed Volume contract, pending the operator's answer: best qualifying
single-set volume, kg·reps in ordinary mode and `100 × effective set volume / B`
(%BW·reps) in enabled bodyweight mode. This fits the current set-based certificate
model. A session-total choice instead needs explicit aggregation, window and
Certified-set eligibility rules before implementation. There is no new reps
board; ordinary reps remain permitted public performance context.

### D9. A certification survives a rule change

The certificate attests the witnessed logged performance; the current score
is its projection under current rules. Group preference/contribution edits,
group target or linked source load-mode edits, metric/unit migration and other
rules-only changes must not void an unchanged performance's certificate.

Retain certification ID, witness, timestamp and original observed revision/value
metadata. Do not overwrite the audit record to match a newly calculated score.
If the set remains eligible, its Certified entry uses the recalculated value.
If it is temporarily ineligible, retain the active certificate but omit its
entry; eligibility returning does not require another witness. Preserve IDs
through the kg-to-percentage migration. Do not resurrect previously ended rows.

Actual edits/deletion/tombstoning of the observed set continue to invalidate its
certificate. Distinguish a source exercise's rule change from a rewrite of the
logged set itself. Manual withdrawal and owner/admin cancellation retain their
current behavior. A different movement remains a different group exercise.
Reading corrections follow D4 rather than being misclassified as rules-only.

### D10. Ownership, compatibility and activation

Private readings remain owner-scoped Sync v2 data. Group rules, percentages,
boards and certificates remain server-authoritative, outside ordinary sync.
Do not change personal calculations/preferences or the private coaching API.

Version new unit-bearing payloads and caches explicitly. Old clients must not
label percentages as kg or bypass D5 through an older enabled-group RPC. Define
an activation/minimum-client policy, old-reader behavior, legacy redaction and cache eviction before release. Preserve internal audit history
while suppressing disallowed public absolute values. Deploy server/evaluator
and compatible clients in the documented order with explicit hosted authority.

## Contradictions resolved and ownership

| Previous requirement / current gap | Consolidated target | Task |
| --- | --- | --- |
| #411 card voids positive-contribution certificates after a rule change | Rebuild where effective; preserve unchanged performance certificates | Existing #411 card + T13 |
| Rules revision and load modes participate in invalidation pins | Separate witnessed facts from scoring dependencies | T13 |
| Old M27 absolute kg bodyweight view, ×BW display and exposed B/provenance | On uses %BW and safe payloads; Off deliberately ranks ordinary Volume/1RM; D5 states inference limits | T08–T10 |
| Current group wire hardcodes kg, lacks Volume ranking and exposes raw shared-session facts | Add explicit Volume/1RM units and enforce D5 at server and decoder/cache boundaries | T08/T09 |
| Old session snapshots/backfill versus current dated readings | Current as-of selection; no snapshot restoration | All active tasks |
| Historic September gate results mistaken for current acceptance | Fresh human review and fresh agreed gates on the finished change | T14 |

## Active task breakdown

| Task | Deliverable | Depends on | Status |
| --- | --- | --- | --- |
| [Existing #411 task — Keep zero-contribution group boards stable](../tasks/T-20260930-01-Keep_zero_contribution_group_boards_stable.md) | No-op legacy preference changes; reconcile rule metadata/history | T13 | planned |
| M27-T13 — Preserve certifications across rule changes | Observed-set pins, migration and rule-only retention; closes #419 | — | completed |
| [M27-T15 — Decide percentage reading-correction policy](../tasks/M27-T15-Decide_percentage_reading_correction_policy.md) | Explicit private-data correction outcome for the new metric | — | planned |
| [M27-T08 — Group percentage contracts](../tasks/M27-T08-Add_group_bodyweight_rules_and_metric_contracts.md) | Volume definition, versioned units, privacy and activation contracts | T15 | planned |
| [M27-T09 — Evaluate private percentage scores](../tasks/M27-T09-Evaluate_group_scores_and_certify_bodyweight_sets.md) | Normalized worker/SQL publication and all group reader privacy | T08, T13, existing #411 task | planned |
| [M27-T10 — Group percentage UI](../tasks/M27-T10-Expose_group_standards_and_bodyweight_rankings.md) | Group rules, %BW boards, details, certification copy and safe caches | T09 | planned |
| [M27-T14 — Human acceptance and workstream closeout](../tasks/M27-T14-Accept_and_close_group_rules_workstream.md) | Human flow acceptance, combined gate pass, rollout and graduation | All active implementation tasks | planned |

The existing #411 task keeps its identifier so its issue link remains valid.
Ready now: T15 and the existing #411 task; T13 is complete. The formula and
switch policy are settled. T08 must record the Volume decision before building.
No parallel-agent execution is implied.
Do not execute the old T01–T07/T11/T12 scope as part of this workstream.

## Current execution checkpoint (2026-09-27)

This heading is retained so old task links resolve. The September checkpoint
belongs to the previous snapshot/three-board implementation and is historical;
its logs and captures remain in git history. They are not proof of the newly
accepted percentage/privacy/certification target. Nothing in this consolidation
marks the historical personal cards shipped or authorizes hosted deployment.

## Milestone acceptance and closeout

1. Zero-contribution preference toggles preserve ready state, scores, rules
   revision, history and active certificates; effective changes rebuild only
   affected comparisons without fake performed-record events.
2. Rule-only edits preserve exact certification IDs/audit metadata, including
   through percentage migration and temporary score ineligibility. Set edits,
   deletion, withdrawal and cancellation still follow their chosen lifecycle.
3. Off ranks ordinary Volume/1RM without reading access. On with positive
   contribution uses the accepted %BW 1RM formula; zero contribution stays
   ordinary. Implement the explicitly chosen Volume aggregation/mode policy.
   Missing private input omits dependent scores without disclosure.
4. Every group-facing route, RPC, old protocol, cache and public historical
   payload obeys D5. Conventional kg boards and private workout/coaching views
   regress cleanly. Privacy is proven from responses, not just screenshots.
5. T15's reading-correction decision is explicit and implemented/tested without
   silently weakening unrelated legacy invalidation cases.
6. A human exercises and accepts the group rule-change, %BW, certification,
   privacy, missing-data and offline/error flows before the combined aggregate
   closeout pass. Automated checks do not replace this review.
7. Use `./boga test for` to propose the implementation lane set and obtain the
   operator's agreement. Expected combined set: fast, backend (including group
   leaderboards/API-live), frontend-ui and ios-groups-e2e; ios-sync-e2e only if
   sync/auth paths change. Run the three required quality targets before PRs.
   Do not introduce Maestro scenarios without justification and approval.
8. Each implementation PR graduates decisions into the owning specs and deletes
   its shipped card. T14 verifies activation/compatibility and closes #420 only
   after its acceptance is satisfied, then deletes this milestone and remaining
   workstream cards. Original unrelated cards need a separate lifecycle audit.

Gate and screenshot evidence belongs in the delivering PRs. Test durations
come only from `./boga timings`; this plan makes no estimates. Hosted rollout
needs the session's explicit deployment authority and the existing RUNBOOK.
