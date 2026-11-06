# Planner

### planner.block-completion · definition · accepted

An ordinary planned block is completed explicitly or when its workout finishes with
confirmed source-derived work; manual-only or unperformed work does not
complete it.

Why: Finishing a workout consumes what the lifter actually performed from the plan without requiring redundant menu taps, while unperformed work remains pending.
Code: `autoCompletePlanBlocksForSession` in `apps/mobile/src/session-planner/block-resolution.ts`; `toBlockViews` in `apps/mobile/src/session-planner/plan-queries.ts`.

### planner.progress-outcomes · presentation · accepted

Ordinary plan and programme progression treats completed and skipped blocks as resolved, but
displayed outcomes keep them distinct. A resolved programme is Completed.
A resolved planned session is Skipped when all its blocks were skipped;
otherwise it is Completed, with both completed and skipped block counts
visible and spoken. Programme summary counts describe session outcomes,
not block totals. Unresolved sessions keep Planned or In progress.
Routine outcomes instead derive from finished workouts with confirmed source work
and explicit Skip uses. Partial work qualifies; manual-only work does not.
Rows show the latest outcome; detail retains both dates. Starting, editing or
abandoning updates neither date. Skip creates no workout or training figures.
History correction, deletion and Undo update completion normally. Missing dates
stay unavailable; Never used means no known use.

Why: Resolving a plan is different from performing its work; neither a badge nor a count should hide skipped work.
Code: `apps/mobile/components/session-planner/progress-labels.ts`; `apps/mobile/components/session-planner/programme-detail-header.tsx`.

### planner.routine-reuse · definition · accepted

Routine is a property of the same standalone plan, including previously used
plans. Programme children cannot be Routines and are never detached automatically.
Routine availability is Anytime; retained schedule metadata returns when turned
off. Each Start copies the entire current definition with fresh unchecked
progress. An active use resumes; another active workout is not replaced.
Future definition edits preserve active and historical workout snapshots.

Why: Reusable intent must survive each use without consuming future availability or rewriting what the lifter logged.
Code: `apps/mobile/src/session-planner/routine-materialization.ts`; `apps/mobile/src/data/session-plan-store.ts`.
