---
task_id: M27-T06-Backfill_and_correct_historical_session_weight
milestone_id: M27
status: in_progress
ui_impact: "yes"
areas: "cross-stack"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/05-data-model.md, docs/specs/tech/bodyweight-load-contract.md, docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md"
---

# M27-T06 — Backfill and correct historical session weight

- Status: `in_progress`
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


## Local implementation checkpoint

The planner, atomic repository, range/selection preview and native reading-entry
handoff are implemented. The fixture and third `ios-bodyweight` flow are wired.
Full `./boga test fast` passed (173 suites / 2,067 tests); the final
`fast-frontend` rerun and all 11 meta-test files passed. All backend lanes passed,
including real sync round trips and schema drift. Logs:
`/tmp/boga-m27-backfill-fast-final.log`,
`/tmp/boga-m27-backfill-fast-frontend-final.log`,
`/tmp/boga-m27-backfill-meta-tests.log`,
`/tmp/boga-m27-backfill-backend.log`.

All three `ios-bodyweight` flows passed at `5a5892b` on both iPhone SE 3
(375×667pt) and iPhone 17 Pro Max (440×956pt), iOS 26.4. Evidence under
`apps/mobile/artifacts/maestro/`:
- `M27-backfill-small-final/20260927-005519-1889/`
- `M27-backfill-large-final/20260927-010457-4564/`

The BWF captures cover invalid/valid ranges, mixed prior/estimated sources,
partial selection, restart/repeat, a manual 79 kg correction, preserved original
override, no readings and native handoff to Add reading. Source dates,
estimated labels and correction provenance were visually compared with T01's
sheet/session targets; no horizontal clipping was found. The initial small run
saved the selected sessions but its Maestro centering swipe dismissed the short
result sheet; `5a5892b` waits and taps the already-visible Done action. The app
and assertions were unchanged; the final small/large flows passed in full.

Logs: `/tmp/boga-m27-backfill-{small,large}-final.log`.
The default-device bodyweight flow also passed at the same revision; its
preview, estimated provenance and explicit correction captures were visually
reviewed: `M27-backfill-frontend-final/20260927-013228-14921/`.
The full `frontend` gate passed every lane at `5a5892b`, including auth/profile,
UI/server sync and both group flows. Groups evidence:
`M27-backfill-frontend-final/20260927-014840-23279/` and
`M27-backfill-frontend-final/20260927-015227-24879/`. Log:
`/tmp/boga-m27-backfill-frontend-final.log`. No shipping completion is claimed.
`./boga test for`, `./boga timings` and the final docs check ran; the required
lane union is covered. No assertion or lane was waived.
`./boga doctor` passed again; completed task-only small/large simulator data was
reset after preserving captures/reports to recover disk space.
