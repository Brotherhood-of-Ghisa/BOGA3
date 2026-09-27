# Bodyweight Load Contract (M27)

> **Status: implemented in the release branch; added-weight revision verification and hosted rollout pending.**
> This contract does not claim that the hosted feature is enabled.
> Owns bodyweight load meaning, dated context, completeness and group dependencies.
> Storage/wire mechanics remain in [05](../05-data-model.md) and
> [Sync v2](sync-v2-server-contract.md); group authorization and ordinary events
> remain in the [groups contract](groups-contract.md).

Dated readings are the source of session body weight. Personal projections are
resolved on read; group projections use the owner's same as-of context. The
load model supports added weight only. Hosted rollout requires the staged procedure
in [RUNBOOK](../../../RUNBOOK.md#dated-bodyweight-cutover).

## 1. Typed values and storage boundary

Names below are camelCase in TS and snake_case on the wire. Domain timestamps
are epoch milliseconds (SQLite timestamp adapters may expose `Date`). Normal
Sync v2 id, timestamps, tombstone and dirty/LWW bookkeeping apply.

| Entity | Additions / representation | Sync decision |
| --- | --- | --- |
| `body_weight_measurements` | `id`, `weightValue: string`, `weightUnit: 'kg' \| 'lb'`, `weightKg: number`, `measuredAt: number`; normal timestamps/tombstone | Owner-private Sync v2 root entity; never a profile field |
| Session read context | `bodyWeightKg`, `bodyWeightSource: 'reading' \| null`, `bodyWeightMeasurementId`, `bodyWeightMeasuredAt` | Derived only; absent from session storage and sync |
| `exercise_definitions` | `bodyweightCoefficient: number` (default 0), `movementStandard: string \| null`, `loadingMethod: string \| null` | In sync scope; current personal metadata reinterprets history |
| `exercise_sets` | `weightUnit: 'kg' \| 'lb'` (legacy kg), `externalLoadMode: ExternalLoadMode \| null`, `plannedWeightUnit: 'kg' \| 'lb' \| null`, `plannedExternalLoadMode: ExternalLoadMode \| null` | In sync scope; actual and planned meanings travel independently |
| Group rules, versions, scores, attestations | Server-authoritative, described below | Out of Sync v2 scope |
| Personal calculations | Read-time projections | Out of sync scope; no achievement ledger |

`ExternalLoadMode = 'added'`. Every numeric set weight means added weight,
including existing null or retired mode tags. There is no assisted/band mode,
load-meaning selector, legacy review, or total-to-added conversion. Existing raw
amounts remain unchanged. Deprecated stored mode fields are retained for wire
compatibility and immutable evidence, but do not alter live calculations. New
logs and imports write `added`; an absent plan retains null metadata.

Both units preserve the entered value and unit; normalize only for calculation
and the measurement's validated kg value with exactly `1 lb = 0.45359237 kg`.
Save measurement raw value/unit and matching kg together. Existing kg-only rows stay kg; the recorded unit is used, with the existing kg default for older rows.
Invalid units remain unavailable. Set-mode hydration never blocks an otherwise
valid numeric weight; unknown exercise rules still require sync or configuration. Positive finite
measurements only; zero, negative, nonfinite, exponent and comma strings are
invalid. Use the existing decimal weight parser; blank logger weight with valid
reps canonicalizes to zero, but blank measurement does not. Reps retain the
existing positive-integer parser. Coefficient is finite in `[0,1]`, displayed
as 0–100%; it is independent of load-input mode and muscle mapping weights.

Resolved context is either absent (all fields null) or identifies the selected
reading and its timestamp. If that reading is malformed, kg is null and the
source/date explain what needs review. Consumers never use an older reading
as a fallback past a malformed latest reading. No manual session-only override
or future-reading estimate is accepted by live calculations.

## 2. Effective load and distribution

Let `E` be the parsed entered mass normalized to kg, `B` the as-of session kg,
`c` the applicable coefficient, and `F=2` for per-side input or `F=1` for total input.

| Exercise | Exercise resistance basis | Muscle per-side basis |
| --- | --- | --- |
| Conventional, total input | `E` (existing meaning) | `E / 2` |
| Conventional, per-side input | `E` (existing meaning) | `E` |
| Bodyweight, total external input | `c × B + E` | resistance / 2 |
| Bodyweight, per-side external input | `c × B + (2 × E)` | resistance / 2 |

The bodyweight per-side case declares bilateral equal external loading; it never multiplies B. Unilateral/asymmetric movements need their
own explicitly configured exercise and total external input; no inferred
half-body model. Mixed conventional group input modes keep the existing
`0.5 | 1 | 2` conversion. Bodyweight group scores always resolve in total-load
space, so the member's external input is normalized once and the group's
coefficient is applied once. Added RM is then expressed in the group’s external
load convention, without scaling B.

For `c=0`, missing or irrelevant B does not affect volume/absolute strength.
For `c>0`, missing B is missing, not 0. Negative entered weight is invalid. Zero resistance has zero volume and no 1RM. Reject nonfinite derived
values (including overflow). A missing/invalid load does not remove a valid
confirmed set's reps or working-set classification.

The pure resolver returns a discriminated union: `known` with entered kg,
total external adjustment, resistance and muscle per-side resistance; `missing`
with a reason (body weight); or `invalid` with a reason
(amount, unit, coefficient, distribution, body weight, overflow). Consumers carry the
reason; they must not use `?? 0` to turn unavailable load into a valid result.

For eligible performed sets, `volume = resistance × reps`; estimated total 1RM
uses existing `estimateOneRepMax(resistance, reps)`. Displayed bodyweight RM
is added weight: `(estimatedTotalOneRepMaxKg - c × B) / F`. Keep the total
capacity separately for inverse projections. Relative strength is total added
RM divided by the **same session B**, independent of external distribution. Muscle analytics applies its per-side basis and current
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
adjustment returns an unavailable added-weight estimate. Per-side entry divides only
the external adjustment by 2. It never changes the historical B or score.

| B | c | External input (total kg) | Reps | Resistance | Volume | Added 1RM (approx kg) |
| --- | --- | --- | --- | --- | --- | --- |
| 80 | 1 | added 0 | 8 | 80 | 640 | 22.14 |
| 80 | 1 | added 20 | 8 | 100 | 800 | 47.67 |
| 80 | .7 | added 0 | 15 | 56 | 840 | 28.51 |

Implementation foundation: `apps/mobile/src/exercise-calculations/effective-load.ts`
implements the pure resolver, performed metrics, coverage, reps eligibility and
named projection conventions. `effective-load-vectors.json` beside it contains
shared numerical evidence, asserted by `app/__tests__/effective-load.test.ts`.
Personal, shared-session, group and coaching consumers use this boundary as
described in §6, §8 and §9.
The vectors and tests
also cover kg/lb parity, bilateral external inputs, missing/invalid context,
zero/negative load, confirmed versus planned, high reps, conventional behavior,
and 60+20 versus 90+20 at equal reps (opposite relative/absolute order).
Percentages and high-rep estimates are declared approximations. Weighted
push-ups require a loading method (e.g. vest); face-value added mass is the
release convention, not a claim of full mass borne through the hands.

## 4. Dated readings and session context

The applicable reading is the latest nondeleted row with `measuredAt <=
startedAt`, comparing exact stored epoch milliseconds. Ties select ascending
reading ID by Unicode code point (SQLite BINARY / PostgreSQL COLLATE "C").
Selection precedes validation. A later reading on the same local calendar day
is still later and cannot supply context. Local date/time entry becomes an
instant once; viewing timezone and DST do not reinterpret a stored instant.

`src/bodyweight/as-of.ts` owns the device resolver: sort the timeline once per
graph, then binary-search each session. `data/bodyweight.ts` batches it into all
repositories. The server `session_weight_as_of(owner,start)` implements the
same ordered selection and strict validation; `bodyweight-as-of-parity.mjs`
cross-checks it against the actual TypeScript resolver, including Unicode
whitespace, binary ID ties, malformed latest rows, pounds and DST instants.

Settings retains required dated kg/lb entry and add/edit/delete history. Future
or invalid readings are rejected on entry. Readings use ordinary local dirty
clocks and sync LWW. Adding a backdated reading, changing a value/date, deleting,
restoring, importing or pulling a reading recalculates affected past sessions.
Changing a session's recorded start resolves its context again. Session and raw
set rows are never rewritten merely because a reading changes.

The UI shows read-only kg and `Reading from <date/time>`. Missing context shows
`No reading on or before this session` and, for the owner, `Add dated reading`
prefilled at the exact session start. Its date stays editable. Malformed context
offers reading history for review. Friends have no entry or correction action.
Forms show the value, unit and date without warnings about historical
recalculation or group results. Missing context does not prevent logging or independent metrics.

Forward migrations remove all four stored session weight columns and the
session-only hydration marker. They preserve readings, raw sets, session clocks
and dirty state; no manual/session value is converted to a reading. The local
migration clears disposable group caches. Unrelated exercise/set hydration
markers remain. There is no historical-fill planner, preview, apply or override.

## 5. Existing loads and canonical identity

Existing numeric values, including zero, are added weight. No conversion or
confirmation wizard runs when enabling bodyweight rules. Actual and planned
amounts, units, reps and performed status remain separate. The ordinary logger
edits them and new rows use added kg. Null and retired mode tags do not suppress
metrics or zero-added reps eligibility. Recalculating never rewrites raw sets.

Only reviewed exact canonical ids receive defaults: `seed_pull_up` (1),
`seed_chin-ups` (1), `seed_parallel_bar_dips` (1), `seed_push_up` (.7).
Those four identities survive the starter catalogue filter;
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

The catalogue's generation 3 patch changes only live, exact
canonical identities whose names still match the bundle and whose known metadata
remains 0/null/null. Renames, custom rules and deleted seeds are preserved.
Unknown old-client metadata defers the generation marker until sync replay has
hydrated it; the cycle checks again after its first pull. Omitted repository
`loadRules` preserves the stored tuple; an explicit valid tuple marks it known.

The logger preserves actual/planned amounts and recorded units through typing,
confirmation, copying and autosave. A stale page whose metadata was unknown
still omits placeholders at the write boundary, preserving later sync hydration.
The exercise page links missing dated context to reading entry. Logger previews,
records and analytics resolve that context through the same boundary (§8).

Session-import v3 carries explicit actual/planned meaning, personal rules for
new exercises and an explicit owner-private reading array (empty is allowed).
Sessions contain no weight tuple. The serializer upgrades v2 packages to v3,
stripping stored session weights; local and remote importers also ignore legacy
v2 tuples, even malformed ones, and never manufacture readings from them.
V1 remains supported; its numeric weights are added weight. Existing package IDs
retain the original import identity namespace. Reimport retains existing package identity; it does not convert amounts. See the owning
[import contract](../../../apps/mobile/scripts/import/BOGA_IMPORT_JSON_CONTRACT.md).

## 6. Group metrics, revisions and certification

**Implementation checkpoint (M27):** `src/groups/metric-contract.ts`,
`performance-score.ts` and `metric-evaluation.ts` provide the pure target-specific
rules/scoring boundary. They accept raw external units/mode, the resolved dated
session context and source distribution/standards; the personal coefficient is not
an input. Invalid B withholds strength while eligible unweighted reps survive.
The v2 wire separates missing/invalid B, values/units and rules revision.
A source's current counting eligibility is separate from its valid performance,
so unlinking need not falsify a historical observation. The database publisher,
versioned RPC readers, metric attestations and typed client are implemented in
`20260927073000_m27_group_metrics.sql` and the existing Edge worker. Their
compatibility and publication boundary is specified in the groups contract §11.
Backend integration gates pass. Group editors, metric boards/history and board/stream
certification have passed native interaction and rendered comparisons at three
phone sizes, including actual local API outages. Hosted rollout remains pending.

| Metric key | Unit | Eligibility / default |
| --- | --- | --- |
| `weight`, `e1rm` | `kg` | Existing conventional boards/conversion retained |
| `bodyweight_reps` | `reps` | Confirmed compatible set with zero added weight; B optional; standard push-up default |
| `relative_strength` | `x_bw` (display ×BW) | Total added 1RM / session B; weighted pull-up/dip default |
| `absolute_strength` | `kg` | Added 1RM under the group’s external distribution |

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
valid only for their original coverage; none silently certifies B.
Reading value/date/deletion/restoration changes enqueue affected shared sessions
through the failure-isolated source queue. Strength pins include resolved kg,
source ID and date; changed context voids dependent attestations. Reps-only and
conventional pins exclude weight context and retain their prior pin version.
The calculation source hash includes `dated_added_load_v3`; strength pins use
version 4, and disposable client caches use v4 keys. Immutable retired record
and certification evidence may still display its original legacy provenance,
but those stored values never supply new live scores. Attestation is not
automatic scale verification.

## 7. Privacy and deployment compatibility

Readings use owner-first PK/RLS and restrictive OAuth direct-access denial.
They remain Sync v2 layer 4 with `capabilities: ["bodyweight_v1"]`. Exercise/set
metadata omission and hydration remain supported; session weight is no longer
part of any push/pull row. Exact old RPC signatures remain so outdated builds
reach the cutoff before accessing removed fields.

Release compatibility commit `11509384` first. It recognizes `UPDATE_REQUIRED`
in setup and steady-state Settings without clearing local data, dirty state or
cursors. After that build is distributed, the forward migration requires
`x-boga-sync-protocol: 2` before normal authenticated sync reads/writes. Missing,
old and malformed protocol values receive an actionable update-required error.
OAuth and anonymous restrictions remain unchanged. Builds older than the
compatibility release cannot be given new UI retroactively; they may display
an older generic error and must update. See the exact staged operator procedure
in RUNBOOK; no hosted deployment is implied by local verification.

Authorized groups receive only needed shared-session context, never the
private timeline or unrelated readings. Coaching uses service-only
`session_weight_contexts(owner,session_ids)` after its existing owner/session
authorization. That helper and the underlying as-of function are unavailable to
normal authenticated/anonymous callers. No evaluator failure can roll back a
personal reading write; normal retry/sweep repairs pending projections.

## 8. Personal consumer integration and refresh

The personal adapter `src/exercise-calculations/analytics.ts` preserves metadata
hydration flags and raw units/mode, and delegates to the kernel in §2. The
following readers supply current exercise rules plus each session’s as-of B:

| Projection | Owning readers / adapters |
| --- | --- |
| Session graph and live/detail rows | `data/session-drafts.ts`, `session-recorder/session-model.ts`, `session-view-model.ts`, `completed-session-detail-model.ts`, `exercise-page-model.ts` |
| Exercise history, suggestions and records | `data/exercise-history.ts`, `data/exercise-block-history.ts`, `session-recorder/exercise-records.ts` |
| Stats and heatmaps | `data/exercise-analytics.ts`, `data/exercise-catalog-stats.ts`, `data/muscle-analytics.ts`, `data/stats.ts` |
| Completion, comparisons and share content | `session-insights/repository.ts`, `session-insights/calculations.ts` |
| Loading calculator | `bodyweight/loading-estimate.ts`, `components/bodyweight/loading-estimate-sheet.tsx` |

Readers batch metadata once per graph, including the full derived reading
context. `bodyweight/snapshot.ts` rejects malformed resolved context even
when their numeric B is positive; all personal projections then withhold the
dependent metrics consistently with the session editor. Pure calculation inputs
may supply an already-validated numeric B. Optional legacy conventional callers keep
c=0 defaults; an explicit `localBodyweightMetadataKnown=false` never uses that
default as evidence. Units normalize only for arithmetic. Blank entered mass
with valid reps follows the existing canonical-zero rule; confirmation remains
independent. Every valid numeric added amount can set a Top added record.

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
therefore stays at zero added weight. Positive adjustments retain full
precision; negative adjustments return unavailable. Manually editing target
B replaces the reading/prefill hint with an explicit entered-target explanation.

Committed reading writes invalidate catalogue stats and mounted dependent views.
Every changed sync pull page invalidates after commit, even if later sync work
fails. Detail graphs, records, insights, open heatmaps and calculators reload;
exercise draft reload flushes pending edits first. Session-start edits also
invalidate context. There is no legacy load-conversion state to invalidate.
Gym scope filters history without changing as-of selection or borrowing a
record from another gym.

## 9. Coaching integration

`agent-api/training-metrics.ts` uses the same effective-load kernel with batched
owner-filtered definitions, sets and as-of contexts. Session SQL selects no
removed columns. The service-only helper returns only selected sessions' context,
never the owner's timeline. Reading changes affect the next API read.

`metric_revision: dated_added_load_v3` replaces `effective_load_v1`. Existing
normalized external `load` remains unchanged; raw `entered_load`, effective
resistance, provenance and volume coverage retain their distinct meanings.
Missing/invalid or truncated totals are null. `session_body_weight.source` is
`reading` or null; deprecated `estimated` remains false. MCP passes the response
through without calculations or database access. The
[API contract](../../../supabase/functions/agent-api/README.md#effective-load-response-evolution)
owns payload details. Hosted rollout remains an explicit operator action.
