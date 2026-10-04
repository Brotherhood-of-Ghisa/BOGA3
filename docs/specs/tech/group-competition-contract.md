# Group competition representation and cutover

> **Status:** accepted representation contract; negotiation, pure scorer,
> allowlist decoders and cache eviction are implemented. Runtime publication,
> group-reader redaction and compatible UI activation are pending. Current
> group RPCs still serve protocol-3 kg Weight/1RM. This is not a release claim.

Owns competitive metric meanings and the protocol-4 transition. Authorization,
queues, coherent publication and current certification storage remain in
[groups-contract.md](groups-contract.md), private kg arithmetic in
[training-metrics-contract.md](training-metrics-contract.md) and dated readings in
[bodyweight-load-contract.md](bodyweight-load-contract.md).

## 1. Metric meaning

Positive **group** contribution identifies a bodyweight exercise. Names,
personal preferences and personal contributions do not. Only group On plus
positive contribution selects normalized competition; Off or zero is ordinary
and never resolves private readings.

The human accepted effective estimated 1RM divided by dated B, retained the
group switch and chose ordinary Volume/1RM Off. The executing agent selected
best single-set Volume under the user's standing autonomous instruction, recorded
on 2026-10-05. This is a delegated decision, not a new explicit human answer.
A session-total ranking was rejected because it would require a different
witness/aggregation window; personal session Volume records keep their contract.

| Metric key | Ordinary unit / value | Normalized unit / value |
| --- | --- | --- |
| `volume` | `kg_reps`: source entered kg converted to group target mode × reps | `percent_bw_reps`: 100 × effective physical total-load set volume / B |
| `e1rm` (default) | `kg`: ordinary source 1RM converted to group target mode | `percent_bw`: 100 × effective physical total-load estimated 1RM / B |

New comparisons default to 1RM. At the versioned cutover, a legacy Weight
default becomes Volume on the new revision; an existing 1RM default stays 1RM.
Keep retired rule defaults and their historic Weight values unchanged.

Public labels are Volume / 1RM and kg·reps / kg / %BW·reps / %BW. There is no
raw Weight, reps board or absolute bodyweight alternative in protocol 4. Raw
workout values stay kg; percentages never replace them or occupy a kg field.
The normalized numerator uses `estimatedTotalOneRepMaxKg`, not the personal
added-load display `estimatedOneRepMaxKg` after subtracting the bodyweight part.

`scoreCompetitionPerformance` uses the existing parser/load/Wathan kernel.
For normalized scoring, source per-side external kg is doubled once before
adding c×B. Both metrics divide by the same valid as-of B used in that addition.
The physical total-load representation makes target distribution cancel: an
alternative target-per-side numerator and B/2 would give the same percentage.
Changing source mode can change physical load; changing only the target mode
changes ordinary scores but not normalized percentages. Never divide a per-side
numerator by whole-body B. Missing/invalid applicable B omits both normalized
metrics, with no zero or kg fallback. Unweighted performed sets with positive
contribution can rank; zero ordinary projections do not.

Each member's board entry is their best qualifying **single set**, independently
for Volume/1RM and Certified/All. Qualifying means live shared/linked/performed,
valid parsed Weight/reps, working under the shared group effort rule, eligible
under that scope and positive finite score. The pure scorer also computes
nonworking performed projections for audit validation; the publisher applies
working/counting. A Volume witness covers that set's logged kg×reps, never
other sets or a session total.

Keep finite unrounded kernel values through publication/ranking. Display rounding
is presentation only; the old six-decimal rank quantizer must not truncate new
competition values. Per-member ties use achieved instant, exercise order, set
order, set-created instant and binary set ID; member ranking ties use achieved
instant then member UUID. History retains original metric/unit/revision; old kg
Weight values are historical Weight, never relabeled Volume or percentage.

## 2. Public boundary

Protocol-4 score identity is a discriminated `(metric, value, unit)`; unit must
match the current group rules. Board envelopes bind rules revision, metric,
scope, state and cursor. Rebuilding is empty, without old/new mixed rows.
`competition-wire.ts` and its exact allowlist guards own the concrete board,
performed-set and certification shapes. Unknown nested fields fail decoding.

Normalized performed-set context contains source/session/set identity, reps,
performed state, source distribution, achieved instant and ordering. It has no
raw added-load kg, kg volume, effective absolute 1RM, private reading ID/date/kg/
provenance, dependency digest or original absolute audit. Ordinary context may
include logged Weight. Public certification state retains ID, witness, time,
observed revision and generic terminal state; immutable observed values and
private pins stay server-side. A score's `write_token` is random, server-issued
and fenced by revision/source generation, never the reading-dependent hash.
Old fingerprint fields cannot be renamed into this token without changing their
origin. Cursor/token expiry or mismatch must reject a stale write.

All group routes must obey disclosure selected by the current authorized
group/comparison state, including old history, retired/archived revisions and
View full session. Historic Off rules must not bypass current enabled redaction. Suppress session/week absolute totals if they would recover a
redacted contribution by subtracting remaining sets. Counts, dates, reps,
duration and permitted ordinary exercise context stay public. A protocol-4
full-session read/cache binds one authorized group; an old unscoped session RPC
must fail closed wherever its response could expose an enabled comparison's kg.
No cross-endpoint join in the same enabled group may recover an absolute
counterpart. Frozen former-member/archived entries with an incompatible unit or
disallowed absolute score are omitted from the current board with generic
unavailable state; preserve their server audit and authorized safe history. Do
not rescore an inactive source merely to invent a display value or mix units. Owner-private workouts/coaching keep their authorized kg access.

Ordinary Off/zero sharing remains intentional. Previously seen Off kg, equivalent
scores in another group or external plate knowledge can be correlated with a
later percentage to infer B. This contract promises private reading
non-disclosure and safe enabled responses, not protection from cross-mode,
cross-group or external inference. Cache eviction cannot erase values seen.

## 3. Witness migration and corrections

A witness attests the logged performance; a score is a current projection.
Rule changes, including metric/unit migration, preserve unchanged-set IDs,
witness/time and immutable original audit. Temporary rules-only ineligibility
keeps an active witness without a Certified entry; eligibility restores it.

The executing agent retained the existing reading-correction boundary under
standing delegated authority. Compare the selected valid reading's ID, exact
instant and kg, not a rounded score or bookkeeping clock. An authoritative
change ends each already-bound dependent projection (`voided`), recomputes All
when eligible and removes Certified eligibility. Keep original audit and append
terminal metadata. Restore never reopens an ended projection; a new witness is
needed. Raw Weight legacy witnesses stay active after private corrections.

Value/date edits, delete/invalid input with fallback or missing context, winning
backdated/restore/equal-time ID selection changes all follow this rule. Losing,
later or malformed candidates and no-ops with the same selected tuple preserve
exact audits. Coalesced updates leaving the authoritative tuple unchanged are
harmless; an already observed correction remains terminal after later restoration.
Off/zero does not query/enqueue readings; retained private pins are checked on
next dependent activation. A never-bound ordinary certificate made ineligible
solely by rules stays active; first valid context binds it and restores its entry.
Public state/copy is generic “Certification ended”/“Score unavailable”, never a
private correction reason/value/date. Raw set corrections/deletions and manual
withdrawal/cancellation keep their existing terminal lifecycle.

At cutover, existing active 1RM witnesses retain their public IDs as 1RM
projections; their original kg audit remains unchanged. Raw Weight witnesses can
supply a new Volume projection only after validating the same observed raw set,
kg, reps, status and source identities: single-set Volume is derived from exactly
that witnessed performance. Create a distinct internal projection aliased to the
original public witness ID; do not overwrite or relabel its Weight audit.
Retain a server-side provenance link to the original witness. A new dependent
Volume projection binds B on first applicable activation without asserting the
witness verified it. Already-ended witnesses cannot supply active projections;
pending corrections cannot be blessed with today's reading during migration.

When multiple eligible historical witnesses cover the same metric/set, preserve
the existing 1RM source for 1RM and existing Weight source for Volume, rather than
merging public IDs. Legacy withdrawal/cancellation ends all projections attached
to that witness; private correction ends only dependent projections. Preserve
original raw legacy rows and ended audit throughout. New certifications are
metric projections of a witnessed single set, not aggregate attestations.

## 4. Inventory and additive transition

| Current surface | Required cutover |
| --- | --- |
| `metric-contract.ts`, `metric-wire.ts`, guards: Weight/1RM, protocol 3, kg, raw performance/fingerprints | Protocol-4 Volume/1RM, explicit mode units, exact safe projection shapes and random write tokens |
| `performance-score.ts`, `metric-evaluation.ts`, `group-eval` | Keep protocol-3 worker until atomic cutover; connect the competition scorer to versioned graphs/publication |
| `group_metric_set_scores`, board entries and certifications: metric/unit checks and six-decimal ranking | Forward constraints accept Volume and mode units; preserve kg audit/revisions, full-precision competition values and distinct witness projections |
| `group_rule_revisions`, `group_events`, frozen/former-member entries | New revisions carry representation version; history retains identity/unit, and enabled readers redact disallowed kg without rewriting stored audit |
| `group_metric_board`, `group_metric_podiums`, `group_metric_history`, `group_metric_revisions` | Safe versioned board/podium/history/revision projections; gate old unsafe readers before percentage publication |
| `group_board`, `group_board_podiums`, `group_board_history` | Legacy ordinary compatibility only where safe; enabled comparisons reject incompatible clients |
| `group_stream`, `group_stream_v2`, record/void/link/rules and certification context | Safe stream/session/history projections with the same group disclosure; no nested old kg payload bypass |
| `group_session_detail`, session card/exercise helpers, `group_week_summary`, `group_get`/summary | Group-bound safe full-session/aggregate output; remove absolute totals that permit subtraction |
| `group_metric_certify`, `group_metric_certification_get/end`, legacy certify/withdraw/cancel | Revision/random-token fencing, generic redacted state, exact witness aliases and terminal outcomes |
| Group exercise list/create/update/archive/unarchive, legacy writes and `group_update` | Versioned metric defaults and coherent effective changes; c=0 toggles stay no-ops with preserved history/certificates |
| `group_cache`, stream/podium/catalogue/week/session keys | Generation 5, group-bound session keys, exact decoding before cache writes/reads; evict all account group projections on upgrade/normalized mode transition |

This delivering contract migration adds only `group_competition_contract(group)`.
It checks app user, OAuth denial and active membership, then requires the exact
`x-boga-group-contract: 4` header. It returns protocol/unit/cache metadata with
`activation_state: pending`. Unsupported/missing/malformed versions get
`UPDATE_REQUIRED`; outsider/nonexistent/deleted groups remain indistinguishable.
Anonymous callers have no execute grant. There is no bodyweight or performance
read and no new Sync v2 entity, snapshot, reading schema or stored achievement.

Schema/publication and the other version-4 RPC implementations above remain
pending until the reader cutover. Protocol-3 production behavior is deliberately
unchanged by negotiation. A pending response cannot activate percentage UI;
unknown contract/unit/cache versions fail closed, without a legacy kg fallback.

## 5. Activation order and evidence

Minimum group client capability after activation is contract 4 plus cache
generation 5; private Sync v2 stays protocol 3. All group application reads and
writes require the group-contract header before source data access at the
cutover. A capable client may use an explicitly safe ordinary legacy endpoint,
but an enabled comparison must reject every unsafe old RPC even if the caller
forges the current capability header. The header is version negotiation, never
authorization or an exemption from server redaction. Before activation, validate every current/legacy reader
above for member/role, anonymous/OAuth/outsider denial and paired payload privacy,
including archive/former-member, history, summary and full-session joins.

With explicit hosted authority, deploy reviewed additive contracts first. Deploy
compatible worker and the atomic schema/public-reader guard cutover together,
keeping competitions unavailable while rebuilding one coherent representation.
Block unsafe old reads/writes before any normalized value is visible. Preserve
Vault secrets, queued jobs and immutable audit. Confirm safe publication and
exact witness IDs, then release/activate the compatible client, evict prior group
caches and verify real two-member normalized/ordinary flows. Hold activation and
repair forward on failure; never restore unsafe old readers or relabel history.
Local gates, pure scorer availability and pending negotiation do not authorize
hosted deployment or substitute for human flow acceptance.
