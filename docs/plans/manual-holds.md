# Manual timed holds

Status: ready for implementation; mocks approved. This PR plans the work only.
Delete this task and its mocks in the PR that implements or abandons it.

## Objective

Log a hold as one manually entered duration, with optional weight, in the
existing exercise and workout flow. Plank and Hollow Hold are the demo exercises.
Use the existing editable Effort selector, default new holds to RIR-0, and
retain explicit set confirmation.

Context: [discussion](https://github.com/Brotherhood-of-Ghisa/BOGA3/discussions/1238).
The operator's subsequent decisions below supersede conflicting suggestions in
that discussion; in particular holds count toward sets and muscle targets, but
have neither Volume nor 1RM.

## Agreed scope

- Exercises choose Reps or Hold; existing definitions default to Reps.
- A hold has positive whole seconds and optional nonnegative Weight. Store time
  separately from repetitions; reject a performed set containing both. Blank
  Weight follows the existing zero-load convention. No repetitions are entered
  or fabricated for holds.
- New hold rows default to `rir_0` (RIR-0) when no Effort is explicitly supplied.
  Keep the existing Effort selector editable and preserve supplied/saved values,
  including explicitly chosen Unspecified; this is a creation default, not a
  read-time replacement or a history rewrite. Repetition-set defaults stay unchanged.
- Normal Effort eligibility applies: holds count by default, not unconditionally.
  A qualifying confirmed hold is one physical working set with the existing
  primary/secondary muscle attribution, weekly targets and counted-session rules.
  Choosing Warm-up, Technique, Cooldown or Rehab follows normal exclusions;
  a personal policy excluding RIR-0 excludes RIR-0 holds too. Planned, invalid
  and unchecked rows do not count. Defaulting Effort does not confirm performance
  or establish that the hold was taken to failure.
- No hold contributes Volume, estimated 1RM, their PRs, RM-curve observations
  or strength-board scores, including when bodyweight calculations are enabled.
  Keep entered Weight visible in personal views; group projections retain
  [[groups.kg-disclosure]]. Add no new hold PR categories in this task.
- Logging has one editable duration value. There is no integrated hold timer,
  separate planned/actual duration pair, target-achievement comparison, failure
  indicator, stopping reason or new effort model. The existing independent rest
  timer is not a hold timer and keeps its current behavior.
- Plans and routines may suggest seconds and optional weight; materialisation
  prefills the same editable duration field, still unconfirmed. The person may
  change it before confirming. There is no structured "hold to failure"
  prescription or badge. Source-derived confirmed work resolves the block
  normally; differing from the suggested seconds does not block completion.
- Carry this through exercise editing, ad-hoc logging, plans/programmes/routines,
  autosave, finishing, completed-history editing, sync/restore and coaching reads
  and writes. Include group session/feed display and normal set counts while
  excluding timed work explicitly from strength scoring.
- Preserve existing repetition behavior and raw history. Changing or merging an
  exercise must never reinterpret historical seconds as reps, or hide them.

## UX contract and design target

Target: the attached editor and session-logger mocks, derived from the existing
React Native screens and the repository's design language; these are mock
screens, not screenshots of an implemented feature.

Human agreement: **approved on 2026-11-19**. The operator approved the editor
and session logger with the Plank/Hollow Hold demo selector, then agreed to
RIR-0 as the default while keeping Effort editable and normal counting rules.
The approved composition is unchanged; the mock's initial/new-row Effort is
now RIR-0. Later material changes to either screen require renewed review.

Approved preview source SHA-256:
`2114a58d1f66159ed90094c87c6f293bd8e8b9b4bff5e9bf53de173bf44e2878`.
Standalone export SHA-256:
`c1270fe0330f57b27ea5e79761518655aeb20bfe96843f9f44b626d5e1e6bf55`.

Mock source: [editable preview](manual-holds-mock.html).
The standalone preview contains both screens and both demo exercises. Its
review controls switch screens and demos; the mock is the design input for
this task. Source/syntax checks and human review do not establish native
rendering or device behavior; those remain implementation acceptance work.

- Editor: retain the page/form structure, name, muscles, Weight and Options;
  add a Recording section with the existing neutral segmented choice. Selected
  mode is Hold in both demos. Reuse `FormSection` and `SegmentedControl` rather
  than creating a new control family.
- Logger: adapt the existing in-place row logger and confirmation pattern:
  editable Effort (default RIR-0), Weight, Time (s), commit. Show recorded duration
  with `s` in closed rows; leave out 1RM/Volume columns, previews and hold record
  panels entirely.
  Preserve independent row editing and confirmation, keyboard access, accessible
  labels, minimum tap targets and visible disabled/invalid states.
- Approval covers the composition and the proposed field labels, with both
  unweighted and weighted data. Native keyboard, small-phone and accessibility
  evidence remains part of implementation acceptance, not this mock review.

## Implementation boundaries

1. **Representation and migrations.** Add an explicit recording mode and typed
   nullable duration columns to the existing stores. Timed plan rows must be
   valid without dummy `target_reps`; preserve enough measurement identity in
   saved plans/workout rows to survive definition changes and unlinked history.
   Do not add a separate planned-duration field to performed sets. Agree the
   shared duration storage/validation bound during implementation.
2. **Shared semantics and adapters.** Extend the existing parser/performed rule,
   hydration, confirmation and completion paths. Keep set/session/muscle
   eligibility distinct from Volume/1RM/record eligibility; do not infer metric
   support solely from the broadened performed predicate. Audit every caller
   and every raw-row adapter, including history suggestions and routine outcomes.
3. **UI.** Adapt the exercise editor, logger, planner and read-only set presenters
   using the agreed mocks. Preserve typed drafts and normal discard handling.
   Empty or unconfirmed duration must not silently become performed work.
4. **Server and readers.** Carry fields through sync entity maps, SQL RPCs,
   canonical snapshots, merge recovery, coaching input/output and group wire
   projections. Preserve permission, ownership, idempotency and revision checks.
   Omit unsupported hold metrics rather than inventing zero-valued measurements.
5. **Compatibility and docs.** Follow the existing sync cutover procedure when
   old clients cannot safely read/write timed plans. Test rejection before row
   movement, retaining dirty work/cursors; coordinate activation separately from
   code integration. Update derivation/coaching/group rule versions as required.
   Keep seed changes separate from demo fixtures unless deliberately justified;
   never rewrite an existing Plank user's reps as seconds.

Start with the existing owners: `apps/mobile/src/exercise-core/`,
`apps/mobile/src/exercise-calculations/`, `apps/mobile/src/data/schema/`,
`apps/mobile/src/data/session-drafts.ts`, `apps/mobile/src/session-recorder/`,
`apps/mobile/src/session-planner/`, `apps/mobile/src/sync/`,
`apps/mobile/components/exercise-catalog/`,
`apps/mobile/components/exercise-page/`, `apps/mobile/components/session-detail/`,
`supabase/functions/agent-api/`, `services/boga-mcp/` and
`apps/mobile/src/groups/`. Audit merges, import/export adapters and derived facts
for lossless representation and explicit metric eligibility; do not build a
general measurement engine or change unrelated repetition arithmetic.

## Product facts to graduate when implementing

This planning PR changes no shipped facts. The implementation must update the
owners instead of leaving the decisions only in this ephemeral task:

- Change `[[set.performed]]` to recognise duration without reps, and
  `[[set.eligibility]]` to distinguish counted holds from unsupported metrics.
- Change `[[set.row-figures]]` for duration rows and `[[planner.block-completion]]`
  only where timed prefills require clarification; preserve the existing rule.
- Record exercise recording-mode/history meaning and the hold duration wording
  in the owning exercise/copy facts where needed, including the hold-only RIR-0
  creation default and its normal Effort-policy eligibility. Apply
  `[[muscle.set-count]]` unchanged to qualifying holds; update the training-metrics and sync contracts
  for the new representation and eligibility boundary.

## Acceptance and verification

- Manually record and confirm Plank at zero external load and Hollow Hold with
  positive Weight. New hold rows start at RIR-0; change Effort using the normal
  selector and reopen/edit both without resetting saved values. Explicit plan,
  routine and coaching Effort values remain intact; absent values default to RIR-0.
- Verify normal Effort exclusions and a custom personal policy excluding RIR-0:
  the matching confirmed holds add no working-set/muscle/session credit. With
  the default policy they count normally. Repetition-set defaults are unchanged.
- A plan/routine suggests 45 seconds, the person logs/confirms 38, and the block
  resolves from confirmed source work. No retained target comparison or failure
  marker appears. A new routine use starts unchecked.
- Finish and restore a hold-only workout and a mixed lifting/holds workout. Each
  qualifying hold adds one physical set with normal muscle credit; a qualifying
  session counts once. Lifting Volume/1RM/records stay unchanged when holds are
  added. Hold-only Volume/1RM are unsupported, not fabricated measurements.
- Prove blank, zero, fractional, invalid, reps-plus-duration, planned and unchecked
  inputs cannot count; historical RIR labels remain readable. Confirmed seconds
  and optional load survive autosave, navigation, history edits, metadata changes,
  merge/recovery, sync round-trips and reinstall restore.
- Exercise coaching plan/log/read/update contracts under current permissions,
  and group display/counts with no hold strength-score or certification leakage.
- Jest covers shared semantics, adapters, planner/routine confirmation, counts,
  metric exclusion and backwards regressions. Read each test area's README before
  editing. Run `./boga test fast`, backend/sync/MCP and relevant native entry,
  history and sync lanes; add group lanes where those paths change. Agree the
  exact set with the reviewer using `./boga test for`; run coverage, complexity
  and dependencies before the implementation PR. New Maestro scenarios require
  the written device-only justification in the testing policy.
- Capture the finished native editor/logger at small and normal widths and
  compare with the agreed target, including keyboard, invalid/unchecked states,
  long names and spoken units. Delete this task and its design inputs when shipped.

## Out of scope

Integrated hold timing, failure detection/prescription, a new Effort model,
separate target-versus-actual hold tracking, hold PRs, conditioning timers,
circuits, cardio fields and sensor/background recovery work.
