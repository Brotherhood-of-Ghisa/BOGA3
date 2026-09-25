---
task_id: M27-T05-Configure_exercises_and_bodyweight_logging
milestone_id: M27
status: planned
ui_impact: "yes"
areas: "cross-stack"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/00-product.md, docs/specs/05-data-model.md, docs/specs/tech/bodyweight-load-contract.md, docs/specs/ui/ux-rules.md, docs/specs/ui/components-catalog.md, docs/specs/ui/screen-map.md"
---

# M27-T05 — Configure exercises and bodyweight logging

- Status: `planned`
- Depends on: M27-T02, M27-T03.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: D1, D2, D5, D7.

## Objective and scope

Make load meaning explicit in exercise setup and the set logger while preserving
legacy training data. Read AGENTS.md, specs 02/03/05/08/09, bodyweight contract,
UI index/policy and the import contract if import handling changes. Refresh the
catalog/import/seed inventory and HEAD; read test-directory READMEs before edits.

## Deliverables and acceptance

1. Extend exercise validation/editor fields for bodyweight contribution and
   movement/loading convention, independently of total/per-side external input.
   Enforce T01's allowed combinations, not equipment-name guesses.
2. Use reviewed seed IDs for 100% pull/chin-ups and parallel-bar dips, 70%
   standard push-ups, and 0% conventional exercises. Do not assign 70% to every
   push-up variant or 100% to machine dips. Preserve user-customized metadata.
3. Inventory existing/imported weight semantics and implement the review path:
   clearly choose added/assisted load versus already-total load before activating
   bodyweight calculations for ambiguous history. Preview any conversion, preserve
   the original values for review, and never silently double-count B. If B is
   unavailable for conversion, leave affected values unresolved and unranked.
4. Label the logger's input Added weight or Assistance and retain positive numeric
   entry. Unweighted is explicit zero after existing blank canonicalization.
   Preserve actual/planned modes through copy, autosave, completion and edits;
   confirming a row still requires the existing explicit action.
5. Coefficient edits explain retroactive personal recalculation. A materially
   different movement uses a separate exercise; edits do not change group rules.
   Unknown band assistance receives no invented numeric conversion.

## UX Contract

Target: T01's bodyweight brief, using existing exercise editor/logger targets.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Configure exercise | Open editor → select bodyweight contribution/loading method → save | Clear input meaning and previewed calculation | Invalid combination/coefficient explained inline; values retained |
| Log set | Open row → choose Added weight or Assistance → enter amount/reps → confirm | BW-only, weighted and assisted sets preserve their meaning | Missing B permits logging but dependent metrics remain unavailable |
| Resolve old logs | Enable BW semantics on an existing exercise → review old entry meaning and any conversion → apply | Only reviewed data is converted/activated | Cancel preserves raw data; missing context blocks unsafe conversion |

Reuse ExerciseCoreFields and logger recipes plus shared UI tokens/fields/sheets;
no raw style exceptions proposed. Capture BW-only/added/assisted/missing/invalid
and legacy review states; attach comparisons and interaction evidence to the PR.

## Verification and closeout

Test seeds for fresh/existing/custom users, import round-trips, ambiguous entries,
planned versus actual, confirmation eligibility and external-mode restoration.
Run `./boga test fast`, `./boga test backend`, `./boga test frontend`; derive
additional lanes with `./boga test for` (including group paths/shared helpers).
Graduate product/load/UX semantics as delivered, attach evidence, mark the
milestone entry complete and delete this card when shipped.
