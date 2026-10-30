# Planner

### planner.block-completion · definition · accepted

A planned block is completed explicitly or when its workout finishes with
confirmed source-derived work; manual-only or unperformed work does not
complete it.

Why: Finishing a workout consumes what the lifter actually performed from the plan without requiring redundant menu taps, while unperformed work remains pending.
Code: `autoCompletePlanBlocksForSession` in `apps/mobile/src/session-planner/block-resolution.ts`; `toBlockViews` in `apps/mobile/src/session-planner/plan-queries.ts`.
