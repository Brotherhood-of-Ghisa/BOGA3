# Bodyweight Load Contract (M27)

> **Status: planned**, except where an implementation is explicitly identified.
> This is the agreed implementation contract, not a claim that M27 is enabled.
> Owns bodyweight load meaning, snapshots, completeness and group dependencies.
> Storage/wire mechanics remain in [05](../05-data-model.md) and
> [Sync v2](sync-v2-server-contract.md); group authorization and ordinary events
> remain in the [groups contract](groups-contract.md).

Baseline reviewed: `a34708c0d6622e2d842771bdfbf2038a38f9aaed`, containing
`origin/main` on 2026-09-26. The existing calculation is **Wathan**, and raw
set weights had no unit or added/assisted interpretation column at that baseline.
T02 implements the paired schema, transport and compatibility replay below.
The implementation order is storage/read compatibility, explicit load entry
and legacy review, consumer adoption, then server-first feature rollout.

## 1. Typed values and storage boundary

Names below are camelCase in TS and snake_case on the wire. Domain timestamps
are epoch milliseconds (SQLite timestamp adapters may expose `Date`). Normal
Sync v2 id, timestamps, tombstone and dirty/LWW bookkeeping apply.

| Entity | Additions / representation | Sync decision |
| --- | --- | --- |
| `body_weight_measurements` | `id`, `weightValue: string`, `weightUnit: 'kg' \| 'lb'`, `weightKg: number`, `measuredAt: number`; normal timestamps/tombstone | Owner-private Sync v2 root entity; never a profile field |
| `sessions` | `bodyWeightKg: number \| null`, `bodyWeightSource: 'reading' \| 'manual' \| 'historical_estimate' \| null`, `bodyWeightMeasurementId: string \| null`, `bodyWeightMeasuredAt: number \| null` | In sync scope; one frozen snapshot tuple |
| `exercise_definitions` | `bodyweightCoefficient: number` (default 0), `movementStandard: string \| null`, `loadingMethod: string \| null` | In sync scope; current personal metadata reinterprets history |
| `exercise_sets` | `weightUnit: 'kg' \| 'lb'` (legacy kg), `externalLoadMode: ExternalLoadMode \| null`, `plannedWeightUnit: 'kg' \| 'lb' \| null`, `plannedExternalLoadMode: ExternalLoadMode \| null` | In sync scope; actual and planned meanings travel independently |
| Group rules, versions, scores, attestations | Server-authoritative, described below | Out of Sync v2 scope |
| Personal calculations and backfill previews | Read-time projections | Out of sync scope; no achievement ledger |

`ExternalLoadMode = 'added' | 'assistance' | 'unquantified_assistance'`.
Amounts remain nonnegative raw decimal text; a mode supplies the sign. Null
mode on a legacy set is unresolved for bodyweight scoring. A conventional
exercise (`c=0`) treats legacy null as added to retain existing results.
Unquantified assistance represents e.g. a band: reps can be logged, but no kg
equivalent or load-dependent score is invented. New logs write an explicit mode.

Both units preserve the entered value and unit; normalize only for calculation
and the measurement's validated kg value with exactly `1 lb = 0.45359237 kg`.
Save measurement raw value/unit and matching kg together. Existing kg-only rows stay kg; an import
warning about unknown units requires review, not guessing. Positive finite
measurements only; zero, negative, nonfinite, exponent and comma strings are
invalid. Use the existing decimal weight parser; blank logger weight with valid
reps canonicalizes to zero, but blank measurement does not. Reps retain the
existing positive-integer parser. Coefficient is finite in `[0,1]`, displayed
as 0–100%; it is independent of load-input mode and muscle mapping weights.

Snapshot tuples are either entirely absent or have positive finite kg and a
valid source. Reading/estimate requires measurement id and actual reading date;
manual has neither. The id is a provenance reference **without a foreign key**:
source deletion must not erase the snapshot or make restoration depend on it.
Consumers reject malformed context as unavailable rather than synthesizing B.

## 2. Effective load and distribution

Let `E` be the parsed entered mass normalized to kg, `B` the saved session kg,
`c` the applicable coefficient, and `s=+1` for added, `s=-1` for assistance.

| Exercise | Exercise resistance basis | Muscle per-side basis |
| --- | --- | --- |
| Conventional, total input | `E` (existing meaning) | `E / 2` |
| Conventional, per-side input | `E` (existing meaning) | `E` |
| Bodyweight, total external input | `c × B + s × E` | resistance / 2 |
| Bodyweight, per-side external input | `c × B + s × (2 × E)` | resistance / 2 |

The bodyweight per-side case declares bilateral equal external loading or
assistance; it never multiplies B. Unilateral/asymmetric movements need their
own explicitly configured exercise and total external input; no inferred
half-body model. Mixed conventional group input modes keep the existing
`0.5 | 1 | 2` conversion. Bodyweight group scores always resolve in total-load
space, so the member's external input is normalized once and the group's
coefficient is applied once, with no second group-mode scaling of B.

For `c=0`, missing or irrelevant B does not affect volume/absolute strength.
Assistance requires a bodyweight exercise; conventional assistance is invalid.
For `c>0`, missing B is missing, not 0. Negative resistance is invalid, never
clamped. Zero resistance has zero volume and no 1RM. Reject nonfinite derived
values (including overflow). A missing/invalid load does not remove a valid
confirmed set's reps or working-set classification.

The pure resolver returns a discriminated union: `known` with entered kg,
total external adjustment, resistance and muscle per-side resistance; `missing`
with a reason (body weight / legacy interpretation); or `invalid` with a reason
(amount, unit, coefficient, mode, body weight, negative resistance, overflow).
Unknown band assistance is an explicit unavailable result. Consumers carry the
reason; they must not use `?? 0` to turn unavailable load into a valid result.

For eligible performed sets, `volume = resistance × reps`; estimated total 1RM
uses existing `estimateOneRepMax(resistance, reps)`; relative 1RM divides by
the **same session B**. Muscle analytics applies its per-side basis and current
role factor (`primary=1`, `secondary=.5`) afterwards. Warm-ups remain eligible
for load metrics but not working sets. RIR policy, confirmation and planned /
skipped / unperformed exclusion remain as in spec 05; no RIR correction to RM.

An aggregate exposes `knownVolumeKgReps`, eligible/known/missing/invalid set
counts, and `complete`. The complete total is null when incomplete. No eligible
sets is a complete empty total of 0. Comparisons, percentile baselines and PRs
must use complete eligible observations and report excluded coverage. Top
weight continues to mean the entered external amount, with its unit and mode.
Volume is an accounting convention, not mechanical work or exercise equivalence.

## 3. Wathan inverse and numeric evidence

Keep the existing forward equation unchanged:
`M = 100 × L / (48.8 + 53.8 × exp(-.075 × reps))`.
An exact inverse is `L = M × (48.8 + 53.8 × exp(-.075 × targetReps)) / 100`.
It round-trips at every supported positive integer rep count, including 1.

The loading calculator explicitly uses **capacity at one rep**: for target 1
it projects `L=M`, matching the milestone's +47.7 kg example. For target reps
above 1 it uses the exact inverse. These are named conventions, never a silent
change to the forward estimator: Wathan at one rep is about `1.01305 × L`.
The exact inverse of 127.67 at one rep is therefore different from 127.67.
Return the convention with the raw projection and keep display/plate rounding
outside the calculation. At target B, `adjustment = L - c × B`; a negative
adjustment is assistance with positive magnitude. Per-side entry divides only
the external adjustment by 2. It never changes the historical B or score.

| B | c | External input (total kg) | Reps | Resistance | Volume | Total 1RM (approx kg) |
| --- | --- | --- | --- | --- | --- | --- |
| 80 | 1 | added 0 | 8 | 80 | 640 | 102.14 |
| 80 | 1 | added 20 | 8 | 100 | 800 | 127.67 |
| 80 | .7 | added 0 | 15 | 56 | 840 | 84.51 |
| 80 | 1 | assistance 20 | 8 | 60 | 480 | 76.60 |

Implementation foundation: `apps/mobile/src/exercise-calculations/effective-load.ts`
implements the pure resolver, performed metrics, coverage, reps eligibility and
named projection conventions. `effective-load-vectors.json` beside it contains
shared numerical evidence, asserted by `app/__tests__/effective-load.test.ts`.
Consumer adoption remains planned; existing production calls are unchanged.
The vectors and tests
also cover kg/lb parity, bilateral external inputs, missing/invalid context,
zero/negative load, confirmed versus planned, high reps, conventional behavior,
and 60+20 versus 90+20 at equal reps (opposite relative/absolute order).
Percentages and high-rep estimates are declared approximations. Weighted
push-ups require a loading method (e.g. vest); face-value added mass is the
release convention, not a claim of full mass borne through the hands.

## 4. Readings, snapshots and historical fill

T04 implements Settings reading entry/history and explicit session correction
in `src/data/bodyweight.ts`, with positive finite kg/lb validation, no future
readings, dirty/monotonic writes and post-commit sync nudges. New-session
`saveDraftGraph` captures the tuple inside its creation transaction; ordinary
updates leave it alone. Intentional correction writes the whole manual tuple
and marks metadata known. UI consumers validate the complete tuple and show
unknown for malformed context. Historical fill uses the pure planner in
`src/bodyweight/backfill.ts` and atomic repository in
`src/data/bodyweight-backfill.ts`.

Settings shows latest nondeleted reading at/before now, with value/unit/date;
history includes all readings. Equal dates resolve by ascending id (for both
latest-prior and earliest-later selection).
Creation copies the latest nondeleted reading at/before `startedAt`, never a
future reading. Missing stays unknown and logging works. Reopen, sync restore,
new weigh-ins and edits/deletion of the source never refresh a saved snapshot.
An explicit session correction changes only the session tuple and explains
personal/group recalculation and affected strength certification invalidation.

Settings' fill flow defaults to completed, nondeleted sessions with missing
tuples; date range is start-inclusive/end-exclusive in the displayed timezone,
and individual selection is explicit. Preview prefers a prior reading, else
the earliest nondeleted later reading marked `historical_estimate`, retaining
its actual date. If no readings exist, offer record weight or an explicit
manual value; never use 0. Backdated/active sessions can use explicit correction.

Preview captures session ids/start times/local versions and source reading
ids/values/units/dates/versions. In one local transaction re-read those inputs
and membership of the relevant reading timeline before writing. A changed
preview requires refresh; an already-filled/deleted session is skipped and
reported, never overwritten. Apply only still-missing snapshots with ordinary
dirty session updates. The implementation applies the selection in one atomic
transaction; a failed write rolls back the entire selection. Repeat is a no-op,
even after later readings. This is local revalidation, not a global
compare-and-set: ordinary cross-device row LWW still applies.

Missing means all four snapshot fields are null; malformed nonempty tuples are
never replaced. Sessions awaiting metadata hydration are blocked. Preview
fingerprints cover live readings and missing completed-session membership,
ignoring only transport dirty acknowledgements. An unselected missing-session
change also requires refresh; concurrently filled/deleted selected sessions are
skipped. The commit recomputes sources from fresh rows, never trusting rendered
snapshot values. Same-time IDs use SQLite BINARY/code-point ordering. Source
measurement IDs remain provenance with no foreign key; restoration can apply
sessions before readings and source deletion cannot erase a saved snapshot.

## 5. Legacy review and canonical identity

The current GymBook digester (`scripts/import/gymbook-digester.ts` under mobile)
imports absent weight as 0, halves a reviewed list of bilateral external
weights, and strips non-kg unit text while emitting `weight_non_kg_unit`.
Its source metadata preserves `weightLoggedKg` / `weightAdjustment` for halved
inputs in the import package, but persisted sets have neither units nor a
bodyweight interpretation. Thus a stored 80 cannot reveal whether it meant
body mass, total resistance, plates, or a non-kg source. No heuristic is safe.

Before activating bodyweight semantics for history, show original amount,
unit/unknown-unit warning, session B/date and preview for selected sets. Choices:
confirm external added/quantified assistance; convert previously total load;
or leave unresolved. Total conversion first normalizes the old total to kg,
then subtracts `c × B` and converts the signed difference to added/assistance
in the declared external input mode/unit. Missing B, unknown units or an invalid
conversion blocks apply. Revalidate preview inputs in the write transaction.
Cancel changes nothing. Unresolved bodyweight rows remain unranked, including
on reps boards; do not assume old zero means unassisted. New import/export
versions carry the new meaning/context fields; old packages remain unresolved.

Only reviewed exact canonical ids receive defaults: `seed_pull_up` (1),
`seed_chin-ups` (1), `seed_parallel_bar_dips` (1), `seed_push_up` (.7).
The T05 inventory confirms those four identities survive the M19 starter filter;
no alias is added. Their initial standards/methods are `Strict pull-up` / `Belt`,
`Strict chin-up` / `Belt`, `Parallel-bar dip` / `Belt`, and
`Standard floor push-up` / `Vest`. These are editable explicit descriptions,
trimmed single lines of at most 120 characters. A positive coefficient requires
both descriptions. There is no name-based classification. Machine/bench/ball dips and incline/decline/knee/other
push-up variants never inherit by substring. Preserve customized metadata.
Movement standard and loading method identify the movement, independent of c.
Links require explicitly matching standards/methods (or reviewed compatible
conventional identities); unequal c alone does not make a link incompatible.
A different movement needs a different exercise. Linking never copies rules
over personal metadata. Two groups can evaluate one set with different c.

T05 implementation: the catalogue's generation 3 patch changes only live, exact
canonical identities whose names still match the bundle and whose known metadata
remains 0/null/null. Renames, custom rules and deleted seeds are preserved.
Unknown old-client metadata defers the generation marker until sync replay has
hydrated it; the cycle checks again after its first pull. Omitted repository
`loadRules` preserves the stored tuple; an explicit valid tuple marks it known.

The logger carries actual/planned units and modes through typing, confirmation,
copy and graph autosave. A stale page whose metadata was unknown omits its
placeholders at the write boundary, preserving a replay completed meanwhile.
New empty rows start with explicit added kg. Copies preserve their source's
meaning, including unresolved legacy rows. Session-only correction is available
on the exercise page. Logger previews resolve the frozen context; broader
records/analytics adoption remains T07.

`src/data/legacy-load-review.ts` inventories actual and planned unresolved values,
previews selected interpretations, and rechecks the complete source membership
and versions in one local transaction. Originals and estimated source dates stay
visible in the preview. Unit choice is always explicit, including old `kg`
placeholders; a legacy zero is unresolved too. Unknown exercise rules must first
be recovered by sync or explicitly configured. For unavailable set metadata,
the user can sync first or intentionally replace the tuple by reviewing every
nonempty actual and planned part of each selected set. Each part has its own
unit/meaning choice; a partial review cannot publish guessed defaults for the
other part. Apply atomically establishes the reviewed tuple and clears metadata
on empty counterparts. This also supports conventional exercises whose old
units are unavailable; known conventional null modes do not require review.
No missing cursor or bootstrap marker proves that a row has never synced.
Changes in sync dirty bookkeeping alone do not invalidate a preview, but
concurrent hydration does. Apply recomputes from current source rows and never
confirms a set. Ordinary autosave continues to preserve unavailable metadata.
The result is ordinary dirty Sync v2 data, with no global compare-and-set claim.

Session-import v2 adds explicit actual/planned meaning, frozen context, personal
rules for newly created exercises and optional owner-private reading content
(an explicit empty array is allowed). The versioned serializer preserves these
fields; local and sync-RPC import paths agree. v1 imports omit new wire fields
and keep old loads unresolved. Both versions use the original import identity
namespace, preventing duplicate sessions just because the schema was upgraded.
Reimport is not a legacy conversion workflow. See the owning
[import contract](../../../apps/mobile/scripts/import/BOGA_IMPORT_JSON_CONTRACT.md).

## 6. Group metrics, revisions and certification

**Implementation checkpoint (M27):** `src/groups/metric-contract.ts`,
`performance-score.ts` and `metric-evaluation.ts` provide the pure target-specific
rules/scoring boundary. They accept raw external units/mode, the complete saved
session tuple and source distribution/standards; the personal coefficient is not
an input. Invalid B withholds strength while eligible unweighted reps survive.
The v2 wire separates missing/invalid B, values/units and rules revision.
A source's current counting eligibility is separate from its valid performance,
so unlinking need not falsify a historical observation. The database publisher,
versioned RPC readers, metric attestations and typed client are implemented in
`20260927073000_m27_group_metrics.sql` and the existing Edge worker. Their
compatibility and publication boundary is specified in the groups contract §11.
Backend integration gates pass. Group editors, metric boards/history and board/stream
certification are integrated; native visual/interaction proof and hosted rollout
remain in progress.

| Metric key | Unit | Eligibility / default |
| --- | --- | --- |
| `weight`, `e1rm` | `kg` | Existing conventional boards/conversion retained |
| `bodyweight_reps` | `reps` | Confirmed compatible set with known zero added and zero assistance; B optional; standard push-up default |
| `relative_strength` | `x_bw` (display ×BW) | Total estimated 1RM / session B; weighted pull-up/dip default |
| `absolute_strength` | `kg` | Total estimated 1RM under group rules |

New scores are `{metric, value, unit, rulesRevision}` everywhere: board rows,
podiums, record payloads, cursors, history, caches and accessibility. Do not
smuggle reps or ratios into `value_kg`. Certified / All and existing strict
tie-break order remain. Viewed metric is local state; admins own default metric,
coefficient, movement standard and loading method. Display added kg and % of
session B as context, never rank mixed-rep performances by either alone.

A group rules edit increments a per-exercise revision and enters `rebuilding`.
Build all affected member entries under one revision and publish atomically
under the group lock; readers expose rebuilding, never a mixed revision.
Revision-bound pagination/cache keys reject an obsolete cursor. Rebuilds have
an explicit rules-change history reason and create no performed PR/void events.
Calculations remain TS in the existing failure-isolated queue, not SQL copies.

Migration retains conventional entries and immutable old events with their old
units/rules. Bodyweight activation retires legacy weight/e1RM views as read-only
history and builds the three new boards. Former members/archived exercises
retain their frozen legacy revision as labelled history; never mix frozen old
scores into a new-revision ranking. On rejoin/unarchive, recalculate before
publishing the current revision. Do not delete historical events to migrate.

Certification pins dependencies per attested metric: raw amount/unit/mode,
reps/performed status, source exercise/load distribution and compatibility;
strength also pins B and its source/date/provenance, while reps-only does not.
Pin rules revision as the explanation of the observed score, but a rules-only
recalculation does not void a valid performance attestation. A rules change
cannot expand an old attestation's dependency coverage: request certification
again for a newly dependent metric. Existing conventional attestations remain
valid only for their original coverage; none silently certifies B or assistance.
Source-measurement edits and new readings do not change snapshots or pins.
Explicit B/load corrections invalidate dependent strength attestations; a B
edit alone preserves reps-only attestation. Estimated provenance is shown at
certify time; this is a member's attestation, not automatic scale verification.

## 7. Privacy and deployment compatibility

Weight measurements use owner-first PK/RLS plus OAuth direct-access denial,
like every synced entity. Include topology/cursors, bootstrap, serializers,
drift, wipe and export/import. Adding a root entity also requires old-client
pull compatibility: an old reader must never encounter an unknown entity.
The implemented reader requests layer 4 with `capabilities: ["bodyweight_v1"]`
and starts its independent cursor at null. Layer meanings 0–3 are unchanged;
the local upgrade replays 0, 1 and 3 once, because an old reader may have
advanced past metadata it ignored. A local known-metadata marker prevents
placeholder defaults from being pushed and permits one-time hydration without
overwriting newer unrelated local edits. Known metadata continues ordinary LWW.
Older readers never receive this entity; upgraded readers do not skip historic
readings. The new client requires the server migration first.

Server writers distinguish absent new fields (preserve stored value) from
explicit null (clear by newer-client intent). Snapshot and metadata tuples
are supplied atomically; partial tuples are rejected at the application
boundary. Tests must prove older writes cannot erase populated new fields.
Row LWW still controls whether the write wins; this is compatibility, not
independent field clocks. Deploy compatible server readers/writers before
enabling new client fields; T12 verifies hosted smoke and rollout order.

Authorized group reads reveal only needed shared session context, never
reading history, owner-private gym coordinates or unrelated measurements.
Coaching remains owner-scoped and read-only, with unit/completeness parity.
No evaluation/notification failure may roll back personal sync.

## 8. Personal consumer integration and refresh

The personal adapter `src/exercise-calculations/analytics.ts` preserves metadata
hydration flags and raw units/mode, and delegates to the kernel in §2. The
following readers supply current exercise rules plus each saved session’s B:

| Projection | Owning readers / adapters |
| --- | --- |
| Session graph and live/detail rows | `data/session-drafts.ts`, `session-recorder/session-model.ts`, `session-view-model.ts`, `completed-session-detail-model.ts`, `exercise-page-model.ts` |
| Exercise history, suggestions and records | `data/exercise-history.ts`, `data/exercise-block-history.ts`, `session-recorder/exercise-records.ts` |
| Stats and heatmaps | `data/exercise-analytics.ts`, `data/exercise-catalog-stats.ts`, `data/muscle-analytics.ts`, `data/stats.ts` |
| Completion, comparisons and share content | `session-insights/repository.ts`, `session-insights/calculations.ts` |
| Loading calculator | `bodyweight/loading-estimate.ts`, `components/bodyweight/loading-estimate-sheet.tsx` |

Readers batch metadata once per graph, including the full saved-weight
provenance tuple. `bodyweight/snapshot.ts` rejects malformed stored tuples even
when their numeric B is positive; all personal projections then withhold the
dependent metrics consistently with the session editor. Pure calculation inputs
may supply an already-validated numeric B. Optional legacy conventional callers keep
c=0 defaults; an explicit `localBodyweightMetadataKnown=false` never uses that
default as evidence. Units normalize only for arithmetic. Blank entered mass
with valid reps follows the existing canonical-zero rule; confirmation remains
independent. Assistance/unresolved rows cannot set a Top added record.

Unknown dependent metrics render unavailable, and known volume subtotals are
labelled incomplete. Entirely unknown volume is not zero. Aggregates propagate
overflow as null; later known rows cannot reset it. Heatmaps distinguish missing
metrics from rest and known zero, and exclude incomplete volume from ranges,
weekly averages and comparison baselines. Comparison cards report the count
of prior sessions excluded for incomplete volume. Working-set/repetition counts
survive, including a known zero on warm-up-only days.

The calculator defaults to the target session B. A current reading is used only
through an explicit action, with its date; an invalid restored reading cannot
provide a target. Each selectable source retains historical B and provenance.
Target edits clear old answers. Dismissed reads cannot update a later opening.
The one-rep capacity convention is explained; high-rep estimates are labelled.
Two-decimal display is separate from raw results and does not imply plate rounding.
Forward/inverse cancellation within two machine epsilons of the resistance scale
normalizes to zero external adjustment. An unchanged bodyweight-only performance
therefore stays unweighted instead of displaying microscopic assistance. Larger
positive and negative adjustments retain full precision. Manually editing target
B replaces the reading/prefill hint with an explicit entered-target explanation.

Explicit B corrections reload detail graphs and insights. Definition edits and
legacy conversion refresh records/history on save or focus. New readings leave
old projections unchanged. Shared-session, group and coaching consumers require
their own corresponding integration; this section does not claim their rollout.

## 9. Coaching integration (locally verified; hosted rollout pending)

`supabase/functions/agent-api/training-metrics.ts` adapts owner-filtered wire
rows to the same analytics and full-snapshot validation boundary used by mobile.
Definitions/session context are batched. Exercise records and workout summaries
use saved B and current personal rules, including unit conversion, canonical
blank zero, assistance and unavailable context. Measurement history is never
queried. New readings and source-reading changes do not replace saved snapshots.

The additive `effective_load_v1` projection preserves the existing normalized
external `load` field and adds raw `entered_load`, effective resistance, metric
basis, session provenance and explicit volume coverage. Incomplete or truncated
totals are null; records exclude incomplete session volume. MCP passes both
structured and text JSON through without recalculating or acquiring database
access. The [API contract](../../../supabase/functions/agent-api/README.md#effective-load-response-evolution)
owns response shapes and compatibility details. Fast, backend contract parity
and real OAuth MCP smoke passed locally; T12 still owns hosted rollout and
deployed verification.
