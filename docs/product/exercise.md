# Exercise

### exercise.merge-scope · definition · accepted

An exercise merge is a one-time transfer of live completed history into an existing
live exercise, followed by ordinary source soft deletion. Deleted sessions/blocks,
saved plans and active workouts stay unchanged. Plans and active workouts can
later create source history; restoring the source never reverses the transfer.
Execution requires a connection and a signed-in app account.

Why: cleanup must preserve authored plans and ongoing training, while committing the destructive transfer atomically.
Code: `supabase/migrations/20261027163253_exercise_merge.sql`; client orchestration in `apps/mobile/src/exercise-catalog/merge.ts`.

### exercise.merge-values · calculation · accepted

Moved history follows the destination exercise's current definition and group
links wherever it appears. Moving it preserves the original measurement mode, seconds and external load and
retains historical tags by name, reusing equivalent destination tags.
The destination's bodyweight contribution applies
without compensating the stored Weight or warning about the contribution change.

Why: transferred history must use consistent units while retaining its raw training and provenance.
Code: `supabase/migrations/20261027163253_exercise_merge.sql`.

### exercise.merge-recovery · principle · accepted

Concurrent workout or merged-history edits retain non-conflicting changes together;
conflicting edits are preserved for explicit review before applying them.
A newer device clock cannot bypass this rule. Review compares current history
with saved values in the current exercise's units.
Keep current changes nothing; Apply writes only the reviewed change against
freshly checked context. Unresolved changes remain visible in sync status.
Unacknowledged recovery stays private to its account across account switches.

Why: merging must never silently discard an offline edit, reverse an identity transfer or mix weight units.
Code: `apps/mobile/src/sync/exercise-merge.ts`; `apps/mobile/src/data/exercise-merge-store.ts`; `apps/mobile/src/data/session-edit-rebase.ts`.

### exercise.browser-history · definition · accepted

For the catalogue and exercise pickers, any live exercise entry in completed,
non-deleted history establishes prior use in the selected gym scope, even without
sets or eligible performed values. Active workouts and future plans do not.
This controls Never-done visibility and wording; training figures remain governed
by [[set.eligibility]].

Why: a recorded entry should remain findable regardless of how its sets were logged or counted.
Code: `aggregateExerciseCatalogStats` in `apps/mobile/src/data/exercise-catalog-stats.ts`; `apps/mobile/src/exercise-catalog/list-model.ts`.

### exercise.recording-mode · definition · accepted

An exercise chooses Reps or Hold for new rows; existing definitions default to
Reps. Changing or merging definitions preserves each saved row's measurement
identity. A new hold defaults missing Effort to RIR-0 without confirming it;
explicit and saved Effort, including Unspecified, stays intact. Repetition
defaults stay unchanged.

Why: creating timed work must not reinterpret history or claim failure.
Code: `apps/mobile/src/data/set-types.ts`; `apps/mobile/src/exercise-core/recording-mode.ts`.


### exercise.quick-entry · definition · accepted

Starting from an exercise adds to the current workout, or starts one now when
none is active. It continues the most recent matching exercise card. Opening
or dismissing the choice creates nothing. Empty and repeated rows need explicit
performance confirmation; repeating history never edits the source workout or
copies its planner attribution. A history view's filters do not set a workout's
gym; [[gym.split]] governs the repeated targets.

Why: a quick log should continue training without creating competing workouts or claiming sets were performed.
Code: `apps/mobile/src/session-entry/exercise-entry.ts`.
