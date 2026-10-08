# Group competition representation

> **Status:** implemented and live. Protocol 4 is the only group
> representation: hosted activation ran on 2026-10-05, and the pending
> protocol-3 server, its readers and the activation step are removed. A fresh
> installation is protocol 4.

Owns competitive metric meanings, the protocol-4 public boundary and the
history the protocol-3 era left. Authorization,
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

New comparisons default to 1RM. The cutover turned a legacy Weight default
into Volume on a new revision; an existing 1RM default stayed 1RM. Retired
rule defaults and their historic Weight values stay unchanged.

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

Keep finite unrounded kernel values through publication/ranking. Display
rounding is presentation only; values are never quantized for ranking.
Per-member ties use achieved instant, exercise order, set order, set-created
instant and binary set ID; member ranking ties use achieved instant then member
UUID. History retains original metric/unit/revision; old kg
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
full-session read/cache binds one authorized group.
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

Protocol-3 witnesses stay history. An active 1RM witness kept its public ID as
a 1RM projection with its original kg audit. A raw Weight witness supplies a
Volume projection only after the publisher validates the same observed raw
set, kg, reps, status and source identities: single-set Volume derives from
exactly that witnessed performance. That projection is a distinct row aliased
to the original public witness ID, never an overwrite or relabel of its Weight
audit, with a server-side provenance link to the original witness. A dependent
Volume projection binds B on its first applicable activation without asserting
the witness verified it. Ended witnesses supply no active projection; pending
corrections are never blessed with today's reading. A legacy kg certification is
imported the same way while its comparison is live and its member active;
archived and departed ones wait for unarchive or rejoin.

When multiple eligible historical witnesses cover the same metric/set, preserve
the existing 1RM source for 1RM and existing Weight source for Volume, rather than
merging public IDs. Legacy withdrawal/cancellation ends all projections attached
to that witness; private correction ends only dependent projections. Preserve
original raw legacy rows and ended audit throughout. New certifications are
metric projections of a witnessed single set, not aggregate attestations.

## 4. Server surface

Every competitive read and write is a `group_competition_*` RPC decoded by the
client's exact guards; the membership and settings RPCs are the only others.
Every group RPC requires the exact `x-boga-group-contract: 4` header before
source data access: missing, malformed or other versions get `UPDATE_REQUIRED`.
The header is version negotiation, never authorization or an exemption from
server redaction. Outsider, nonexistent and deleted groups stay
indistinguishable; anonymous callers have no execute grant on competition
RPCs. Private helpers have no client or service execute grants.

`group_competition_contract(group)` checks app user, OAuth denial and active
membership and returns protocol/unit/cache metadata. Its `activation_state` is
always `active`; the shape is frozen, though no client reads it. Minimum
client capability is contract 4 plus cache generation 5; private Sync v2
protocols are separate. No bodyweight or performance read, Sync v2 entity,
snapshot, reading schema or stored achievement belongs to it.

The worker evaluates protocol-4 graphs with the shared competition scorer
(`competition-evaluation.ts`). SQL checks the evaluation contract,
claim/generation, revision and complete source token before publishing
unrounded scores in one transaction. Readers take shared group locks so a
policy change cannot split authorization and disclosure. Random score tokens
change on replacement; certify also refreshes the live source fingerprint.

Disclosure retains immutable historical source associations and extends them
through stored ranked set IDs to a moved current exercise. Unlink, archive,
identity edits or a delayed worker cannot expose a kg counterpart to a saved
percentage. Unrelated ordinary session context keeps its logged kg; unbound
exercises retain reps and conservatively omit kg in an enabled positive group.
Historical values preserve original units and carry `unavailable` with null
value when current disclosure suppresses them. Full-session and week totals
contain no absolute volume field that could recover a redacted contribution.

First binding requires a valid selected reading. Volume aliases carry null
observed Volume audit and an explicit witness reference; original audit stays
at the root. Terminal aliases are never imported again. Frozen 1RM entries the
cutover preserved keep exact saved values and their original membership
period; incompatible units or dependency states were omitted, never
rescored.

## 5. Hosted changes

A hosted deploy of competition SQL or the worker needs the operator's explicit
authority. Preserve Vault secrets, queued jobs and immutable audit. Repair
forward on failure; never restore a removed reader or relabel history. Local
gates do not authorize hosted deployment or substitute for human flow
acceptance.
