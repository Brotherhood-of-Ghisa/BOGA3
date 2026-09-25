---
task_id: M27-T04-Add_Settings_weight_and_session_snapshots
milestone_id: M27
status: planned
ui_impact: "yes"
areas: "frontend|cross-stack"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/05-data-model.md, docs/specs/tech/bodyweight-load-contract.md, docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md"
---

# M27-T04 — Add Settings weight and session snapshots

- Status: `planned`
- Depends on: M27-T02, M27-T03.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: D3, D5, D10.

## Objective and scope

Let users record current weight in Settings and automatically populate every
new session with a stable snapshot. Read AGENTS.md, specs 02/03/05/08/09,
the bodyweight/sync contracts, UI index and AI design policy. Refresh HEAD and
route/repository inventory before implementation; read test-directory READMEs.

## Deliverables and acceptance

1. Add Body weight to `app/(tabs)/settings.tsx`: current reading, measurement
   date, explicit unit and add/edit/history entry points. Positive finite weight
   saves locally offline; current means latest by measurement time, not last
   edited row. Normalize storage to kg; deterministic same-time ordering is part
   of T01's contract. Reject future-dated current readings in this release.
2. A central session-creation path chooses the latest reading at/before start,
   once, for all creation routes (including any existing planned-session path).
   No reading means null, not zero. Existing sessions are not refreshed on load.
3. Show the snapshot and source date in session detail/edit; allow an explicit
   override without changing Settings weight. New readings do not alter an
   already-active session, and source deletion does not erase its snapshot.
4. Reading history supports correcting/deleting measurements with clear wording
   that saved sessions are unchanged. Route to T06 for historical filling.
5. Save failures retain input, account switches wipe owner data, restore preserves
   snapshots, and imported/backdated sessions do not silently borrow future B.

## UX Contract

Target: T01's `ui/design-targets/bodyweight.md`, following the accepted
`ui/design-targets/more-settings.md` and existing session design targets.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Save current weight | More → Settings → Body weight → enter weight/unit (date defaults now) → Save | Value/date visible immediately; local save survives restart | Invalid value is inline; local failure preserves input; offline remains usable |
| Start workout | Start any new session after saving a reading | Session shows the reading used; next reading affects only a later session | No reading shows unknown and a non-blocking entry route |
| Correct session | Session body-weight control → edit value → save | Session value changes explicitly and metrics refresh | Explain effects on records/certification; cancelled edits do nothing |
| Correct measurement | Settings weight history → edit/delete a reading | History/current selection updates | Existing snapshot values stay fixed, with source context retained |

Reuse UI fields, sheets, ListRow, Stat and Notice with documented tokens; no raw
color exceptions planned. Capture populated/empty, invalid, offline and session
override states on target phone sizes; compare with T01's target in the PR.
Update route and component docs only for actual new navigation/component APIs.

## Verification and closeout

Test local persistence, date selection, unit conversion, second-session defaults,
active-session stability, source edit/delete, account switch and wipe/re-pull.
Run `./boga test fast`, `./boga test backend`, `./boga test frontend` and resolve
the actual diff with `./boga test for`; frontend includes `ios-sync-e2e`.
Graduate session/UX rules, attach evidence, mark the milestone entry complete
and delete this card when shipped.
