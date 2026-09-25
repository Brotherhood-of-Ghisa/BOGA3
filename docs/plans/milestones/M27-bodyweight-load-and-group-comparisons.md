# M27 — Bodyweight load and group comparisons

- Milestone ID: `M27`
- Status: `planned`
- Created: 2026-09-25
- Planning baseline: `c1104b65` on `origin/main`
- Source: the bodyweight exercise design discussion and the user's request for Settings weight entry and historical backfill.

This is an implementation plan, not a claim that these behaviours are shipped.
The task delivering a behaviour updates its owning spec. Delete this milestone
and its task cards when the work ships; keep evidence in the PRs.

## Objective

Make bodyweight exercises contribute meaningful volume and strength estimates,
preserve the body weight used for each performance, and let groups compare
repetitions, relative strength and absolute strength under shared exercise rules.
Users enter current weight in Settings; new sessions capture it automatically.
An explicit backfill operation supplies missing historical session weights,
including an estimated fallback from the earliest later reading.

## Parent references

- Agent entrypoint: `AGENTS.md`
- Product: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data and sync: `docs/specs/05-data-model.md`, `docs/specs/tech/sync-v2-server-contract.md`
- Groups: `docs/specs/tech/groups-contract.md`
- Auth/API: `docs/specs/10-api-authn-authz-guidelines.md`, `supabase/README.md`
- Gates and coverage: `docs/specs/02-quality-and-test-gates.md`, `docs/specs/06-testing-strategy.md`
- UI: `docs/specs/08-ux-delivery-standard.md`, `docs/specs/ui/README.md`, `docs/specs/ui/ai-design-policy.md`
- Placement: `docs/specs/09-project-structure.md`

## Agreed behaviour

### D1. Entered weight and effective load

Entered weight remains the external amount: an unweighted pull-up is `0`, and
a pull-up with a 20 kg belt is `20`. Preserve raw values and units; never replace
them with a derived total. An explicit `Added weight` / `Assistance` mode gives
the non-negative entered amount its sign. Planned targets carry that mode too.

For this milestone's declared load convention:

```text
B = the body weight saved on this session
c = the applicable exercise's bodyweight contribution coefficient
A = added external load, or 0
H = quantified assistance, or 0
L = c × B + A − H
volume = L × reps
total estimated 1RM = estimateOneRepMax(L, reps)
relative estimated 1RM = total estimated 1RM / B
```

One shared resolver validates this context before calling the existing Wathan
calculation. Conventional exercises (`c = 0`) do not need B and retain existing
entered-load results. Missing B is not zero. Invalid/negative resistance is not
clamped into a plausible score. Zero resistance has zero volume and no 1RM.
Sets, reps and working-set eligibility remain independent of missing B.
Confirmed/performed, warm-up and RIR rules stay as defined in spec 05.

For bilateral bodyweight variants, resolve the body contribution in total-load
space once; apply existing per-side and muscle-role factors afterwards for
muscle analytics. Never double or halve body weight because an external input
is per-side. T01/T03 define and test any allowed mixed modes explicitly.

Volume is a load-times-repetitions convention, not mechanical work or a
cross-exercise equivalence measure. No change of RM equation or RIR adjustment
is included. Correct stale Mayhew references when documenting the actual Wathan
implementation. Very high-rep estimates remain estimates, not measured maxima.

### D2. Personal exercise metadata

| Exercise | Initial bodyweight contribution |
| --- | --- |
| Conventional externally loaded exercises | 0% |
| Pull-ups / chin-ups | 100% |
| Parallel-bar dips | 100% |
| Standard floor push-ups | 70% |

The coefficient is independent of `load_input_mode` and muscle mapping weights.
Other push-up variants, machine dips and assisted machines must not inherit a
coefficient through a name substring. Seed only reviewed canonical identities;
custom/ambiguous exercises need explicit configuration.

Coefficient edits reinterpret personal history using each session's saved B,
consistent with current retroactive exercise metadata policy. A different
movement is a different exercise. Body-weight snapshots themselves never follow
such metadata edits.

The percentages are editable accounting approximations. Standard push-up hand
support varies through the movement. For weighted push-ups the group/personal
exercise must identify the loading method (for example a vest); counting added
mass at face value is an explicit approximation in this release, not a claim
that all that mass is borne through the hands. A general external-load leverage
model and individualized biomechanical calibration are outside this milestone.
Do not invent a kilogram equivalent for band assistance.

### D3. Settings and session body weight

Add a `Body weight` entry to user Settings, currently
`apps/mobile/app/(tabs)/settings.tsx`, reached through More. It shows the latest
reading and its date, accepts a positive finite weight with an explicit unit,
and saves a dated measurement locally/offline through the normal sync domain.
It is not merely a mutable field in the online-only `user_profiles` layer.

New sessions copy the latest nondeleted measurement at or before `startedAt`.
If absent, the session remains unknown and can still be logged. Store the
numeric kg value, source measurement identity/time where applicable, and
provenance (reading, manual override, historical estimate). Session corrections
can be saved without changing the current Settings reading.

New readings, edits/deletions of source measurements, reopening a workout and
sync restoration never silently refresh an existing session snapshot. An active
session also stays fixed until an explicit session correction. A user can see
which reading was used and correct the session from its detail/edit surface.
Preserve the snapshot even if its source measurement is later deleted.

### D4. Historical backfill

Expose `Fill missing session weights` beside weight history in Settings. The
default selection is historical, nondeleted sessions whose snapshot is missing;
allow a date range and session selection. Preview the affected count, source
dates/weights and estimated fallbacks before applying.

For each selected session:

1. Prefer the latest nondeleted measurement at or before its start.
2. If none exists, use the earliest available nondeleted reading, even though
   it is later than the session. Mark it `historical estimate` and retain the
   actual measurement date. This is the user's requested fallback.
3. If no readings exist, require a reading or an explicit value; do not fill 0.

Do not interpolate or apply today's weight indiscriminately. A backdated session
with no earlier reading can use the same explicit preview/correction flow;
ordinary session creation does not silently use a future reading.

Apply only to snapshots still missing when the operation commits. Recheck the
preview's inputs before writing so edits made meanwhile are not overwritten.
Persist ordinary dirty session updates, with retry-safe progress if the operation
is batched. Running it twice does not change filled sessions. Ordinary Sync v2
row LWW still applies across devices; do not promise a global compare-and-set.

The resulting values are frozen snapshots. Editing a weigh-in does not re-run
backfill. Replacing an existing value is an explicit session correction (with
its impact explained), not the default bulk operation. Show estimated provenance
in personal and group score details and when certifying a performance.

### D5. Existing entered loads and missing metrics

Some historical bodyweight sets may already include body mass in entered weight.
Do not blindly add B or rewrite raw sets. T05 inventories known imports and
defines a user-reviewed interpretation/normalization path before enabling new
bodyweight semantics on ambiguous legacy data. Preserve the original values in
the review and apply a conversion only when explicitly selected. A failed or
unknown conversion cannot silently yield a ranked score.

Missing body weight permits reps, working sets and the unweighted-reps board.
Load-dependent metrics render unavailable, and aggregate volume identifies
partial coverage; neither the UI nor API presents the known subtotal as a
complete total. Historical comparisons/PR baselines use eligible complete data
and expose missing coverage instead of comparing partial totals as equal peers.

### D6. RM records and loading estimates

Personal bodyweight strength records compare estimated total resistance. A
calculator translates that strength estimate into an external load for a chosen
rep count using the target session's B (or explicitly selected current B):

```text
predicted external adjustment = predicted total resistance at target reps − c × B
```

Positive results mean added load; negative results mean required assistance,
not negative plates or a silently clamped zero. Keep raw estimates separate
from any user-facing plate rounding. Display total and added-load meanings
explicitly; `Top weight` for a bodyweight exercise means entered external load,
not a hidden change to total resistance. T03 specifies the inverse convention
and the existing Wathan near-one-rep boundary so the forward and inverse paths
are tested rather than accidentally contradictory.

At 80 kg B, `+20 × 8` pull-ups give 100 kg effective load, 800 kg·reps volume
and approximately 127.7 kg estimated total 1RM. Its estimated one-rep added
capacity is 47.7 kg at B=80, or 45.7 kg at B=82. That is a present-day projection;
the historical score and B remain unchanged.

### D7. Group authority and links

The group exercise owns its coefficient, movement standard, loading convention
and default ranking. Owners/admins edit them. A personal exercise links to this
comparison identity; the group evaluates raw performance plus the session
snapshot under its own rules. Linking never overwrites personal metadata, and
two groups can evaluate the same performance under different declared rules.

Reject or explain incompatible movement/loading links; a coefficient does not
convert knee push-ups to floor push-ups. Personal coefficient edits must not
improve a group score. Ordinary total/per-side conversion remains supported
without multiplying the body contribution a second time.

### D8. Group rankings

| Board | Score / eligible set | Default |
| --- | --- | --- |
| Bodyweight reps | Maximum confirmed reps in one set; zero added load and zero assistance; known compatible movement; B may be missing | Standard unweighted push-ups |
| Relative strength | Estimated total 1RM divided by **that session's** B; both inputs required | Weighted pull-ups/dips |
| Absolute strength | Estimated total 1RM in kg, using **that session's** B | Alternative bodyweight view |

Every board supports Certified / All and retains the current deterministic tie
policy. Keep conventional exercises' existing Weight / 1RM behaviour. Bodyweight
boards require units of reps, ×BW and kg; do not store/display them all as
`value_kg`. Record cards, podiums, pagination, histories, caches and accessibility
labels must carry the metric and its unit. A group exercise has an explicit
default metric; changing the viewed metric is local presentation, not a rule edit.

Display added load as both kg and % of session B when B is known. Do not rank
mixed-repetition performances by added kg or added % alone. In unweighted sets
at fixed c, relative 1RM is just c times the repetition multiplier; the reps
board communicates that performance directly. Relative strength is an
understandable competition convention, not a claim of perfect size neutrality.

At five pull-up reps, a 60 kg person adding 20 kg has 80 kg total load and
1.33×BW; a 90 kg person adding 20 kg has 110 kg total and 1.22×BW. At equal reps
the latter leads absolute strength and the former relative strength.

A future `most reps at +20% BW` challenge would prescribe a load and rounding
tolerance and then rank reps. Capture this distinction, but a generic challenge
builder, weight classes and allometric scoring are not deliverables here.

### D9. Group recalculation and certification

Version group calculation rules. A coefficient/rule edit recalculates the whole
affected board under one version and is labelled as a rules change, not a newly
performed PR. Avoid serving mixed-version rankings while rebuilding. T08/T09
must define migration of current Weight/e1RM history, archived/former-member
entries and existing certifications without destroying the historic event log.
Different movements get new group exercises, not retroactive relabelling.

Certification details show and pin all performance inputs used by the score:
external amount/mode, reps/performed status, session B and its provenance where
applicable. Correcting B or a load mode/value invalidates affected strength
certifications; rules-only recalculation does not falsely claim that the
observed performance changed. Pin only dependencies of the attested metric so
an irrelevant B edit need not invalidate an unweighted-reps-only attestation.
Certification is a member's attestation, not automatic proof of a scale reading.

New weigh-ins do not invalidate historical certifications because they do not
alter snapshots. Backfill/corrections re-evaluate scores through the same
failure-isolated queue. No evaluation failure may roll back personal sync.

### D10. Sync, privacy and derived data

- **In sync scope:** owner-private weight measurements, session snapshots and
  provenance, personal load metadata, actual and planned external-load mode.
  Pair local/remote schema, serializers, cursors/topology, bootstrap, drift,
  account wipe and export/import treatment in T02/T05.
- **Out of Sync v2 scope:** group rules/versions, boards and certification
  projections (server-authoritative); rendered previews and computed personal
  metrics (derived only). Do not persist a personal achievement ledger.
- Reading history stays owner-private. A group gets only the session context
  needed to explain its shared scores through authorised group RPCs, not access
  to the member's entire weigh-in history. The coaching API follows its existing
  read-only, owner-scoped training boundary; no new agent write capability.
- Roll out the server schema and compatible readers before the client writes
  the new fields. Test older writers cannot erase populated new fields. T12
  owns production deployment ordering and the deployed smoke checks.

## UX delivery

T01 pins a repo-native brief with reference screenshots for the new states,
using the accepted Settings, exercise, session and group targets as the visual
baseline. The user's accepted behaviour does not make unrendered screenshots
accepted visual evidence. Each UI card below includes its flows and edge cases;
implementation must render them, compare against the target, and attach fresh
captures to its PR. Reuse `components/ui` tokens, fields, sheets, lists and notices.

## Task breakdown

| Task | Deliverable | Depends on | Status |
| --- | --- | --- | --- |
| [M27-T01 — Contracts and design target](../tasks/M27-T01-Define_bodyweight_contracts_and_design_target.md) | Exact domain types, compatibility and UX target | — | planned |
| [M27-T02 — Synced data](../tasks/M27-T02-Add_bodyweight_schema_and_sync.md) | Measurements, snapshots, personal metadata and load mode | T01 | planned |
| [M27-T03 — Shared calculations](../tasks/M27-T03-Implement_effective_load_and_RM_calculations.md) | Resolver, volume, forward/inverse RM and completeness | T01 | planned |
| [M27-T04 — Settings and snapshots](../tasks/M27-T04-Add_Settings_weight_and_session_snapshots.md) | Weight entry/history and stable new-session defaults | T02, T03 | planned |
| [M27-T05 — Exercise setup and logging](../tasks/M27-T05-Configure_exercises_and_bodyweight_logging.md) | Coefficients, reviewed seeds/legacy values, added/assisted entry | T02, T03 | planned |
| [M27-T06 — Historical backfill](../tasks/M27-T06-Backfill_and_correct_historical_session_weight.md) | Preview, earliest-reading fallback and explicit corrections | T04, T05 | planned |
| [M27-T07 — Personal analytics](../tasks/M27-T07-Integrate_bodyweight_analytics_and_loading_estimates.md) | Consistent metrics, records, history and loading calculator | T03–T06 | planned |
| [M27-T08 — Group rules and board contracts](../tasks/M27-T08-Add_group_bodyweight_rules_and_metric_contracts.md) | Group authority, metric units/versioning and migration | T02, T03, T05 | planned |
| [M27-T09 — Group evaluation and certification](../tasks/M27-T09-Evaluate_group_scores_and_certify_bodyweight_sets.md) | Per-group scores, re-evaluation and attestation dependencies | T06, T08 | planned |
| [M27-T10 — Group UI](../tasks/M27-T10-Expose_group_standards_and_bodyweight_rankings.md) | Rule editor, links, podiums, three boards and record details | T07, T09 | planned |
| [M27-T11 — Coaching API and MCP](../tasks/M27-T11-Align_coaching_API_and_MCP_bodyweight_metrics.md) | Owner-scoped, unit-aware data and metric parity | T07 | planned |
| [M27-T12 — Integration and rollout](../tasks/M27-T12-Verify_roll_out_and_close_bodyweight_milestone.md) | Cross-device/group proof, server-first rollout, graduation | T01–T11 | planned |

Dependencies describe delivery order, not a request to spawn agents. No task
is complete merely because a downstream closeout card lists its tests.

## Milestone acceptance

1. Settings weight saved offline populates every subsequently started session;
   later measurements cannot change prior or already-active sessions.
2. Explicit backfill uses a prior reading or the earliest later reading, labels
   the latter estimated, preserves filled snapshots and is repeat-safe.
3. The numerical examples above, conventional lifts, assisted sets, missing B,
   planned/unperformed rows, warm-ups and per-side muscle allocation are covered.
4. All personal, shared-session and coaching surfaces agree on effective load,
   completeness, total 1RM and raw external load meanings.
5. Members cannot improve group scores by editing a personal coefficient; group
   rules and session B determine ranking. All three boards and their defaults work.
6. Input corrections, rules edits, unlinking, deletion, membership changes and
   certification transitions produce the specified boards/history without fake PRs.
7. Weight history remains private; snapshots and new metadata survive offline
   writes, LWW conflicts, account switches and wipe/re-sign-in restoration.
8. Server-first rollout and old-client behaviour are verified before enabling
   the client feature. Durable decisions move into the owning specs as shipped.

## Verification and closeout

Each implementation PR runs `./boga test for` on its actual diff, then every
required gate to green. Expected milestone union: `./boga test fast`,
`./boga test backend`, `./boga test frontend` and `./boga test mcp-smoke`.
Backend includes `sync-infra` and `groups-leaderboards`; frontend includes
`ios-sync-e2e` and `ios-groups-e2e`. Run required individual lanes when not
already covered by the aggregate, and `handles` when async teardown changes.
Do not defer local Docker or simulator lanes. Run `./boga doctor` and fix
bootstrap gaps before declaring a capability unavailable.

Read each test directory's README before editing its tests. Use measured
`./boga timings` only; this plan makes no duration estimates. T12 owns deployed
schema/function/client smoke validation, PR evidence and final deletion of this
milestone; earlier tasks graduate their own durable decisions and delete their
cards when shipped, marking their task-table entries completed.

## Research context

- [Suprak et al., body mass supported during push-up variants](https://pubmed.ncbi.nlm.nih.gov/20179649/): a basis for a simple approximate coefficient, not a universal measurement.
- [Weighted push-ups and load-velocity relationships](https://pmc.ncbi.nlm.nih.gov/articles/PMC7386139/): loading method/support affects effective resistance.
- [Strength scaling to body size](https://pubmed.ncbi.nlm.nih.gov/18172672/): relative strength is not synonymous with a validated size-neutral competition score.
