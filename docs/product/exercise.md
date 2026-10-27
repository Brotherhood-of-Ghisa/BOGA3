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

Moved history uses the destination's current definition and existing group links.
Actual and planned Weight convert between total and per-side input without display
rounding; same-mode stored text stays verbatim. Tombstoned child sets convert
without revival. No coefficient compensation or warning is added.
Historical tag labels survive; destination normalized-name matches are reused,
including deleted tags without revival. Definitions, muscle mappings, plans and
group links are never copied.

Why: transferred history must use consistent units while retaining its raw training and provenance.
Code: `supabase/migrations/20261027163253_exercise_merge.sql`.

### exercise.merge-recovery · principle · accepted

An edit from an older merged history context is preserved for explicit review
before applying it. A newer device clock cannot bypass this rule.
Review compares current history with saved values in the current exercise's units.
Keep current changes nothing; Apply writes only the reviewed change against
freshly checked context. Unresolved changes remain visible in sync status.
Unacknowledged recovery stays private to its account across account switches.

Why: merging must never silently discard an offline edit, reverse an identity transfer or mix weight units.
Code: `apps/mobile/src/sync/exercise-merge.ts`; `apps/mobile/src/data/exercise-merge-store.ts`.
