# Planner

### planner.block-completion · definition · accepted

A planned block is completed explicitly or when its workout finishes with
confirmed source-derived work; manual-only or unperformed work does not
complete it.

Why: Finishing a workout consumes what the lifter actually performed from the plan without requiring redundant menu taps, while unperformed work remains pending.
Code: `autoCompletePlanBlocksForSession` in `apps/mobile/src/session-planner/block-resolution.ts`; `toBlockViews` in `apps/mobile/src/session-planner/plan-queries.ts`.

### planner.progress-outcomes · presentation · accepted

Programme progression treats completed and skipped blocks as resolved, but
displayed outcomes keep them distinct. A resolved programme is Completed.
A resolved planned session is Skipped when all its blocks were skipped;
otherwise it is Completed, with both completed and skipped block counts
visible and spoken. Programme summary counts describe session outcomes,
not block totals. Unresolved sessions keep Planned or In progress.

Why: Resolving a plan is different from performing its work; neither a badge nor a count should hide skipped work.
Code: `apps/mobile/components/session-planner/progress-labels.ts`; `apps/mobile/components/session-planner/programme-detail-header.tsx`.
