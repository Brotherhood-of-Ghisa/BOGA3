---
task_id: M27-T06-Backfill_and_correct_historical_session_weight
milestone_id: M27
status: planned
ui_impact: "yes"
areas: "cross-stack"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/05-data-model.md, docs/specs/tech/bodyweight-load-contract.md, docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md"
---

# M27-T06 — Backfill and correct historical session weight

- Status: `planned`
- Depends on: M27-T04, M27-T05.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: D3–D6, D9, D10.

## Objective and scope

Fill missing historical B with an explicit, simple, repeat-safe operation,
including the user's earliest-later-reading fallback. Read AGENTS.md, specs
02/03/05/08/09, bodyweight/sync contracts and UI index/policy. Refresh current
repositories/HEAD before implementation and read test-directory READMEs.

## Deliverables and acceptance

1. A pure preview planner selects the latest reading at/before each session;
   where absent it selects the earliest available later reading and labels it
   estimated. Deleted readings/sessions are ignored. No interpolation or fake 0.
2. Settings → Body weight → Fill missing session weights provides date range,
   session selection and a preview of count, weights, source dates and estimated
   cases. Default scope is missing historical snapshots; already-populated
   sessions remain unchanged. No background retroactive filling on new weigh-ins.
3. Apply checks the preview inputs and still-missing snapshots before writes.
   Changed inputs refresh the preview; concurrent local overrides are preserved.
   Use a local transaction or retry-safe batches with clear progress/results.
   Sync normally as session edits; global multi-device resolution remains LWW.
4. An explicit individual correction can replace an existing/estimated snapshot
   without editing the source reading. Explain recalculation and effects on
   affected certified scores; group effects are delivered by T09's evaluator.
5. Backdated session creation without a prior reading can open this same review
   or a manual override; it never silently fills from a future reading.
6. Provenance survives retries, sync, restore and source edits/deletion. A second
   backfill run leaves filled values alone, even after a new reading is added.

## UX Contract

Target: T01's bodyweight brief and existing Settings/session sheet patterns.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Fill history | Settings action → choose range/sessions → inspect preview → Apply | Missing snapshots filled; counts and estimated provenance shown | No reading offers entry; stale preview refreshes; partial failure is retryable |
| Review fallback | Select session earlier than first reading → inspect later source date | User knowingly saves an estimated value | Cancelling writes nothing; existing snapshot is not overwritten |
| Correct a value | Open historical session → edit saved B → save | Only selected session recalculates | Invalid input retained; consequences for group certification explained |

Reuse sheets, list rows, Notice, fields and action controls with UI tokens.
Capture mixed known/estimated preview, no-readings, stale-preview/error and
completed-result states; verify accessibility and comparison against T01 target.

## Verification and closeout

Fixtures: readings on Sep 10=80 and Sep 20=82; Sep 5 session → estimated 80,
Sep 15 →80, Sep 21 →82. A filled Sep 5 override stays unchanged. Add an earlier
reading after apply: no saved value moves until explicitly corrected.
Cover no readings, source deletion, same-date tie, timezone boundary, partial
retry, re-run and sync/restore. Run `./boga test fast`, `./boga test backend`,
`./boga test frontend` plus actual-diff requirements from `./boga test for`.
Graduate backfill/UX rules, attach evidence, mark the milestone entry complete
and delete this card when shipped.
