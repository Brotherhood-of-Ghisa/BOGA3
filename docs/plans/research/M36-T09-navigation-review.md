# Final RM chart entry — review handoff

Status: production entry implemented and independently source-reviewed on the experimental branch, based on T08 commit `7c21d18b` and draft PR #741. T09 remains in_progress. Its native lane/scenario agreement and final human entry/return review are pending; no T09 acceptance scenario has been written or run. Main is untouched, and no merge/ready transition is authorized.

## Target and scope

The operator directed “Approved, start t09” on 2026-10-14. The [approved native r1 target](../designs/M36-T05-rm-chart-review.md) governs: live selected-exercise History → Options → RM curve, then Back to the prior History. The operator’s branch-only instruction overrides the template’s merge-first sequence. T08’s chart acceptance and native gesture proof are retained; no chart, formula, effort/load semantics, data transformation or research runtime changed.

The delta adds `app/rm-curve.tsx`, the encoded `rmCurveHref` builder, its existing app-protected root-stack declaration and one row in History’s existing Sheet. The action remains available for a live exercise with no muscle mappings or training, disappears on deletion, and is never offered by muscle History. Back uses the existing shared arrow, popping the retained History or replacing to Progress for a cold link. The required ID follows the existing trimmed-first-value convention; changed params remount chart scope. The chart’s window anchors on focus. No new navigation model, dependency, production harness or write path was added.

## Proof and boundaries

| Claim | Evidence |
| --- | --- |
| Entry, correct exercise and bounded wave | Real Expo Router plus migrated SQLite: canonical frozen plateau at week22, default12-window counts, no future week24 row, exact dated selection. No duplicate fixture/oracle. |
| Context and draft preservation | Change chart range to4 weeks, then Back: History’s carried Sets metric and previously focused week survive; the raw active draft row remains unchanged. Physical scroll position remains a native check. |
| Safe entry | Absent/blank/unknown/deleted IDs remain in route with Back; cold-entry Back reaches Progress. Repeated/encoded IDs and an updated link on a mounted route are covered. |
| Live action removal | Catalogue deletion while History Options is open removes the chart action without navigating. |
| Protected access | The actual RootStack suite proves signed-out and first-sync denial, and bootstrapped app access. Its chart stub isolates route access; it is not chart evidence. |
| Native rendering | Existing exercise-page fixture over on-device SQLite: History, protected chart host and missing-ID state render in slot59. This does not establish native menu push/Back or gesture acceptance. |

The new suite preserves the repository’s Reanimated stubs when Expo Router’s testing setup replaces them. The Timeline’s visual week is intentionally hidden from VoiceOver because its plot supplies the accessible value; only that visual assertion includes hidden elements. Route-path and visible-page assertions separately establish the returned screen.

## Native review

The isolated `BOGA wt59` simulator uses pinned iOS27, viewport402×874. Production Expo Router/RootStack and actual native SQLite run in the ordinary infra-free preview; no custom chart host or production route mutation is used. The existing fixture supplies Barbell Bench Press, seven qualifying observations from two sessions and no supported prior reference. No fallback curve is invented. Native page and missing-ID captures match the approved host/header/state patterns; actual History Options/Back interaction is still pending.

Ignored evidence: `apps/mobile/artifacts/review/rm-curve-navigation/`, including native captures/hierarchies, live-preview log and source gate logs. The [local gallery](http://127.0.0.1:8759/review-gallery.html) presents captures and their boundaries. The current native preview opens at exercise History; for hands-on review use its Options → RM curve and Back while retaining the metric/week and workout draft. Do not infer native or auditory VoiceOver success from screenshots or Jest. T08’s disclosed VoiceOver limitation remains.

## Gates and review

Retained agreed five checks: fast PASS (286 suites / 3,926 tests plus aggregate checks); coverage PASS (86.55% branches / 94.41% lines); complexity PASS; dependencies PASS (525 modules / 2,636 dependencies, 13 known unchanged); docs-check PASS. Eleven tests are added and existing entry expectations updated. No duration is asserted.

Fast initially failed while starting the isolated Supabase analytics/vector services; restarting only this task’s stack recovered it without a configuration change or skipped check, then the whole fast gate passed. Source test construction also needed the existing animation mock and the explicitly hidden visual-week assertion; no production workaround was introduced.

Changed-path defaults are fast/frontend/docs/Jest; cumulative milestone defaults additionally select backend/groups-leaderboards. Prior approved T06 data/calculation narrowing remains applicable to unchanged source; no server/schema/sync or group-consumed calculation changed. The pending T09 proposal retains five checks plus ios-exercise-page, ios-session-view and one chart-entry native scenario, narrowing full frontend by judgment. The operator may choose full frontend instead. No sweep was requested; there is no release build.

Independent source/product review is clean. Its two documentation findings are resolved: component inventory names the new host, and entry/return are in the exhaustive navigation table. Durable route/param/return owners and completed product Pending metadata are updated without changing accepted statements. Final native/human evidence remains required before acceptance, a completed T09 PR, planning deletion or milestone closeout. All task PRs remain drafts/unmerged by operator choice.
