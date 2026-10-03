# Optional Bodyweight Calculations Contract

> **Status: accepted current contract.**
> This document owns ordinary/bodyweight-aware calculation meaning, private and
> group policy, dated context, kg-only migration, refresh and consumer behavior.
> Storage/wire mechanics remain in [05](../05-data-model.md) and
> [Sync v2](sync-v2-server-contract.md); group authorization and publication
> remain in the [groups contract](groups-contract.md).

Ordinary logging is the default for every exercise. Bodyweight-aware calculations
are optional and independently enabled by a private user or a group. Turning a
capability off ignores its contribution without deleting contributions, readings
or workout history.

## 1. Durable values and preferences

Names below are camelCase in TypeScript and snake_case on the wire. Domain
timestamps are epoch milliseconds. Normal Sync v2 identifiers, timestamps,
tombstones and dirty/LWW bookkeeping apply.

| Entity | Final representation | Sync decision |
| --- | --- | --- |
| `user_settings` | Singleton id `settings`; `bodyweightCalculationsEnabled: boolean`, default false | Owner-private Sync v2 root entity |
| `body_weight_measurements` | `id`, positive finite `weightKg: number`, `measuredAt`; normal timestamps/tombstone | Owner-private Sync v2 root entity; never a profile or group field |
| Session read context | Selected measurement and kg for internal calculation | Derived only; absent from session storage and sync |
| `exercise_definitions` | `bodyweightContribution: number`, fraction in `[0,1]`, default 0 | In Sync v2 scope; current personal metadata reinterprets history |
| `exercise_sets` | Actual/planned Weight text is kg | In Sync v2 scope; raw Weight remains the source value |
| `groups` | `bodyweight_calculations_enabled`, default false | Server-authoritative and outside Sync v2 |
| `group_exercises` | `bodyweight_contribution`, fraction in `[0,1]`, default 0 | Server-authoritative and outside Sync v2 |
| Calculated metrics | Read-time/device or server projections; the device-local exercise session facts are a rebuildable cache of them (`05-data-model.md`) | Never Sync v2 entities or persisted personal achievements |

The private and group preferences are independent. The private preference
controls personal UI, analytics and connected-coach output. The group preference
controls group projections for that group. Neither preference copies, clears or
mutates the other preference, either contribution, any reading, or a raw set.

The UI edits contribution as a decimal percentage from 0 through 100 and stores
the corresponding fraction. Zero is ordinary math. Positive values enable
bodyweight-aware math only while the applicable preference is enabled.
`loadInputMode` (`total_load` or `per_side_load`) describes the exercise's
entered Weight distribution, not bodyweight semantics.

All Weight values, planned Weight values, readings, group rules/results,
imports/exports and coaching payloads are kg. Exactly `1 lb = 0.45359237 kg`
for migration. Display formatting never mutates stored precision.

## 2. Calculation policies

The pure calculation boundary requires an explicit policy so personal fallback
cannot accidentally enter strict group scoring:

- `ordinary`: ignore the preference-independent stored contribution and every
  reading. Use contribution `0`.
- `personal`: when the private preference is enabled, use the personal
  contribution. A missing applicable reading supplies `B = 0` without a warning
  or incomplete state. When disabled, behave as `ordinary`.
- `group`: when the group preference is enabled, use the group's contribution.
  A positive contribution with no applicable valid member reading returns no
  bodyweight-dependent score. When disabled, behave as `ordinary`.

Let:

- `E` be entered Weight parsed as kg; blank performed Weight canonicalizes to 0;
- `B` be the applicable bodyweight kg after the policy above;
- `c` be the applicable contribution fraction;
- `F = 1` for `total_load` and `F = 2` for `per_side_load`.

Ordinary policy, a disabled applicable preference, or `c = 0` uses:

```text
calculated load = E
Volume          = E × reps
displayed 1RM   = estimateOneRepMax(E, reps)
```

The entered Weight is the complete ordinary calculation load; `loadInputMode`
does not rescale ordinary Volume or 1RM. When the applicable preference is
enabled and `c > 0`, use:

```text
calculated load = c × B + F × E
Volume          = calculated load × reps
total 1RM       = estimateOneRepMax(calculated load, reps)
displayed 1RM   = (total 1RM - c × B) / F
```

Bodyweight is counted once. Per-side entry doubles only external Weight in the
positive-contribution branch. The UI shows Weight, 1RM and Volume, never the
calculated-load breakdown.

The Wathan estimator remains:

```text
1RM = 100 × load / (48.8 + 53.8 × exp(-0.075 × reps))
```

Only positive integer reps are eligible. Reject negative/nonfinite Weight,
contribution outside `[0,1]`, invalid distribution and nonfinite/overflow
results. Malformed reading rows are not applicable readings; selection skips
them and may use an older valid row. If none is valid, the reading is missing
for policy purposes.

A valid zero calculated load produces numeric Volume `0` and 1RM `0`. Reps,
performed-set counts, working-set classification and effort remain usable. A
zero Weight/1RM/Volume result never creates a personal or group record, ranking
or achievement. Invalid input never becomes zero implicitly.

Top weight is always the highest raw entered Weight in kg. It never includes
bodyweight contribution and never changes after a preference, contribution or
reading edit. A warm-up keeps its own per-set load metrics but is not a
working set, and never feeds a record, PR or best (`ux-rules.md` §5.11);
planned, unperformed, invalid, deleted and tombstoned rows remain ineligible.

For muscle analytics, ordinary total input contributes `E / 2` per side and
ordinary per-side input contributes `E` per side. Positive-contribution math
first resolves total `c × B + F × E`, then halves it. Apply the mapping role
factor (`primary = 1`, `secondary = 0.5`) afterwards. No derived metric is
written back to a set or session.

## 3. Dated readings

The applicable reading is the latest valid, nondeleted row with `measuredAt <=
session.startedAt`, comparing exact epoch milliseconds. Ties select ascending
reading ID by Unicode code point (SQLite BINARY / PostgreSQL COLLATE `C`). A
malformed restored row stays visible/editable in history but is skipped for
calculation. A later reading on the same calendar day does not apply backwards.

`Body weight log` owns kg-only add/edit/delete and history and remains available
regardless of the private calculation preference. Readings are private,
sync offline through the normal owner-scoped domain, and never live on a session.
There is no session prompt, card, entry link, override, correction or automatic
dialog. Adding, editing, deleting, restoring, importing or pulling a reading
refreshes every affected personal projection and every enabled positive-
contribution group projection without rewriting sessions or sets. Off/zero
group projections do not read or invalidate on private readings. Editing a
session start resolves context again where the active policy requires it.

Personal screens do not expose a missing-reading warning: the personal policy's
zero fallback keeps Weight, 1RM and Volume available. Group readers may omit a
dependent score, but must not reveal whether omission resulted from a missing,
invalid or otherwise ineligible private reading.

## 4. Contributions, seeds and history

The exact personal seed identities below receive curated defaults:

| Seed id | Contribution |
| --- | ---: |
| `seed_pull_up` | 100% |
| `seed_chin-ups` | 100% |
| `seed_parallel_bar_dips` | 100% |
| `seed_push_up` | 70% |

Every other seed and every new personal or group exercise defaults to 0. Names
never imply a contribution. Personal seed defaults are not copied to group
exercises. An explicit personal-exercise/group-exercise link is sufficient;
linking never copies or edits either side's preference or contribution.

Current private preference and current personal contribution reinterpret all
personal historical projections. Current group preference and current group
contribution reinterpret live group projections under the group's coherent
revision/publication boundary. Repeated off/on cycles restore the stored values
unchanged.

## 5. Kg-only migration and protocol 3

The forward migration preserves session, session-exercise, set, reading and
exercise identifiers; row clocks/tombstones; actual/planned Weight and reps;
performed status; readings; and existing contribution values. It performs these
changes atomically:

1. Preserve existing personal and group contribution fractions.
2. Add the private and group preferences with migrated value `false`.
3. Normalize valid actual/planned Weight text and dated readings to kg using the
   exact factor above, without display rounding. Blank set fields remain
   blank/null and malformed Weight remains invalid.
4. Produce exactly the durable shapes in §1; session weight context remains
   derived.
5. Clear disposable derived/group caches and enqueue affected group projections;
   never rewrite a raw workout solely to refresh a metric.

The server schema and RPCs require `x-boga-sync-protocol: 3`; missing,
malformed or unsupported protocol values receive `UPDATE_REQUIRED` before row
access. The v3 client carries the fields in §1, includes `user_settings` in
layer 0 and pulls readings in layer 4.

## 6. Personal UI and consumers

Settings presents `Bodyweight calculations` with an On/Off control and a separate,
always-visible `Body weight log` row that opens dated kg history. Disabling the
toggle hides the exercise-editor contribution field but never hides reading
management or deletes anything. The personal exercise editor shows only
`Bodyweight contribution (%)` plus a short hint while enabled.

The logger always says `Weight`; rows, records, History, Stats, completion and
share surfaces use `Top weight`, `1RM` and `Volume`. They do not expose the
calculation breakdown or prompt for a reading during a workout. Numeric zero
renders as `0`, not unavailable. Raw top Weight stays independent from derived
1RM and Volume.

Repository adapters batch the synced preference, current exercise definition
and as-of readings with graph reads. Preference/contribution/reading/session-time
commits and relevant sync pulls invalidate mounted projections after commit.
Refresh failures retain the prior view and expose the normal retry state; they
must not fabricate calculations or mutate raw history.

## 7. Group calculations, privacy and certification

Group owners/admins control the group preference. While enabled, group exercise
editing exposes the group's independent contribution. Both values survive
disable/re-enable cycles. Non-admins can read the enabled state and contribution
needed to understand availability but cannot edit them.

Group Weight boards remain raw entered kg, without source→target load-mode
conversion. A 1RM/Volume projection uses the
group policy and contribution, never the member's private preference or personal
contribution. With a positive group contribution and no applicable valid member
reading, the dependent 1RM/Volume/record/ranking is absent while raw shared sets,
reps and Weight remain. Publication replaces a whole rules revision atomically;
readers never mix enabled states or contributions.

For an explicitly linked exercise, the kernel uses the member/source
exercise's `loadInputMode` to derive its displayed 1RM. The group evaluator then
applies the source→group-target mode conversion to that 1RM for board
comparison and record detection. It does not pass the target mode into the
kernel. Volume has no target-mode conversion.

The evaluator may resolve a member's private reading internally only for an
authorized group calculation whose group preference is enabled and contribution
is positive. Off/zero evaluation performs no private-reading lookup. No
group-facing RPC, cache, event, board, record
detail or certification returns the value, reading date, reading identifier,
history, provenance or dependency digest. UI copy uses a generic ineligible/no
score state and does not reveal why a member lacks a derived score.

Certification attests the observed/logged performance, not that the certifier
verified bodyweight. The server stores an internal calculation-dependency digest
covering the set, source and group-target load modes, and applicable group
preference/contribution/revision. Only an enabled positive contribution adds the
selected private reading or an explicit `missing` sentinel; off/zero digests do
not query or include reading facts. The digest never crosses the group boundary.
A change to any included dependency voids the certification before a
recalculated result can inherit it. Certification RPCs identify the
record/revision and re-read dependencies server-side; the client never supplies
or receives private reading facts.

## 8. Coaching and import/export

The connected-agent API applies the private preference. When disabled it returns
ordinary calculations and no bodyweight reading or bodyweight provenance. When
enabled with positive contribution, an authorized coach may receive
bodyweight-aware derived metrics and the applicable private reading required to
interpret them. Enabled zero-contribution results remain ordinary and omit
reading context. Missing reading follows the personal zero policy. Group
settings never affect coaching.

Coaching and import/export payloads are kg-only and carry the private preference,
personal contribution and dated `weight_kg` readings where their existing
authorization/export scope permits. Removed unit/mode/movement/loading fields are
rejected by the clean package/protocol version rather than silently preserved.

## 9. Verification ownership

Pure vectors cover all three policies; contribution 0/decimal/100%; total and
per-side input; exact kg conversion; blank/zero; missing, malformed and changed
readings; invalid/overflow values; Wathan projection; and zero record exclusion.
Group mismatch vectors keep raw Weight unchanged, derive 1RM in source mode
before converting it to target mode, leave Volume target-unconverted, and prove
both mode changes rebuild/invalidate. Privacy vectors prove off/zero group
evaluation performs no reading lookup or reading-change invalidation, while a
positive missing dependency is rebuilt when its first reading arrives.
Migration tests use populated old schemas and prove retained identities, clocks,
history, readings and contributions plus removed columns. Sync/backend tests cover
preference/contribution convergence, reinstall restore, protocol cutoff, coherent
group publication, strict missing-score behavior, non-disclosure and certification
invalidation. Coaching/import tests cover preference gating and clean kg payloads.

Component/native evidence covers the Settings row, repeated toggle persistence,
kg history, conditional contribution fields, ordinary/bodyweight-aware logging,
numeric zero, historical refresh and group administration. The UI target
is [the bodyweight design target](../ui/design-targets/bodyweight.md).
