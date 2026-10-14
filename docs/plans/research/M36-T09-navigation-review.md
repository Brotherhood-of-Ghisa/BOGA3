# Final RM chart entry — review handoff

Status: experimental T09 implementation and acceptance completed on 2026-10-15. Human UI approval, independent review and all agreed gates are green. [Draft PR #742](https://github.com/Brotherhood-of-Ghisa/BOGA3/pull/742) remains stacked on T08 commit `7c21d18b` / draft PR #741. Main is untouched; no merge or ready transition is authorized.

## Approval and scope

The operator approved T08 and directed starting T09 on 2026-10-14, then accepted the exposed entry/return with “ok T09 approved - proceed”. This accepts the proposed focused native set after the concrete native/gallery preview, before its acceptance scenario was written/run. The [native r1 target](../designs/M36-T05-rm-chart-review.md) governs: live selected-exercise History → Options → RM curve → Back. The branch-only instruction overrides merge-first planning. No chart, formula, effort/load semantics, transformation or research runtime changes.

The production delta adds the protected route, encoded canonical-ID builder and one row in History’s existing Sheet. A live exercise with no mappings/training still has the action; deletion removes it; muscle History does not offer it. Back pops retained History, or replaces to Progress for a cold link. Trimmed first ID, changed-ID scope reset and focus-anchored chart window follow existing conventions. No write path, dependency or native configuration was added.

## Native finding and fix

The approved native scenario exposed a real scroll reset when History Options opened, before pushing the chart. UIKit also handled the header Pressable’s tap as scroll-to-top, consistent with [the upstream React Native report](https://github.com/react/react-native/issues/56061) and the installed screens library’s iOS27 guard source. Memoizing the header callback did not fix it and was reverted. Its temporary component-style test mock was also reverted because Router actually invokes a render callback.

`IconButton.nativeHeader` selects the installed gesture library’s native UIControl-backed `Touchable`, retaining the house glyph, 44pt target, tones, press feedback, disabled state and accessibility props. Only History Options and RM Back opt in. Ordinary controls keep their Pressable path. Two existing primitive tests now run for both hosts; the existing native-boundary stub covers shared actions/props, while the actual device scenario proves scroll preservation. Approved layout and labels are retained.

Earlier probes also corrected two test assumptions: a harness-teleported exercise had no parent session, so the scenario now enters from the owning session card; the existing History window contains a partial extra plotted week, so the scenario asserts metric and session identity rather than an invented exact plotted-week count. No calculation was changed. The failing restoration assertion was retained.

## Evidence

| Claim | Proof |
| --- | --- |
| Canonical exercise, bounded wave and details | Real Router/migrated SQLite with the shared frozen plateau at week22; future observations excluded; selected set, range change and History metric/week retained. No duplicate numerical oracle. |
| Draft data and safe route/access | Real draft row unchanged; absent/blank/unknown/deleted IDs, encoded/repeated params, mounted-link change, live deletion, signed-out and first-sync denial covered by existing route suites. |
| Physical entry/return and Grid scroll | Final native scenario: July remains at the same position before Options, behind its Sheet and after chart Back; chart disappears. Captures01/02/04. |
| Timeline and local chart scope | Exact prior-session card and Top-weight plot remain after changing chart range and Back; captures05/06. |
| Workout preservation | Existing Train/session navigation resumes edited 87.5 kg × 5 with Set 3 still in progress; capture07. |

Native chart scenario PASS1/0: `apps/mobile/artifacts/maestro/rm-curve-navigation/20261014-235115-85577/`. Its generated flow copy, JUnit, commands and seven screenshots are retained. It runs the ordinary production Router/RootStack with on-device SQLite on `BOGA wt59`, iOS27, viewport402×874. Existing Bench fixture: seven qualifying completed sets, two sessions, unsupported prior reference; no fallback line. The ad hoc source is deleted after review, per test policy; no new permanent lane/harness is introduced.

## Gates and boundaries

Agreed set: fast; jest-coverage; complexity; dependencies; docs-check; ios-exercise-page; ios-session-view; one focused chart navigation scenario. Root-stack default full frontend is narrowed by agreement: no auth/sync/groups behavior changed, protected route access is covered by Jest. Cumulative backend/groups defaults retain prior T06 narrowing for unchanged calculations/read models. No release/sweep requested.

Finished-source fast PASS: 286 suites / 3928 tests plus aggregate checks. Coverage PASS: 86.56% branches / 94.41% lines; complexity PASS; dependencies PASS: 525 modules / 2637 edges, 13 known unchanged. Docs-check PASS; rechecked after final evidence metadata. The existing two native lanes were rerun to green after the shared-button fix. Logs, review and gallery live in ignored `apps/mobile/artifacts/review/rm-curve-navigation/`; Maestro run folders carry device evidence. No duration is estimated.

Source review is clean, including the native control and accurate Jest boundary. Independent final evidence review is clean: JUnit, run copy, commands and all seven native captures checked. The ad hoc source has been deleted; its self-contained generated run copy remains. Actual auditory VoiceOver activation/announcements and interaction on other device sizes remain unverified; screenshots and mocks do not establish them. T08’s accepted research/chart evidence is reused; no detector, calibrated statistical claim or two-curve production feature is added.

Final native evidence (each PASS 1 scenario / 0 failures):

| Check | Artifact root |
| --- | --- |
| ios-exercise-page | `apps/mobile/artifacts/maestro/ad-hoc/20261014-235351-99254` |
| ios-session-view | `apps/mobile/artifacts/maestro/ad-hoc/20261014-235504-4805` |
| chart navigation | `apps/mobile/artifacts/maestro/rm-curve-navigation/20261014-235115-85577` |

All PRs stay draft/unmerged by owner choice. The branch deliverable is complete; milestone shipping DoD still requires authorized merges, ephemeral planning deletion and worktree release. Retain this evidence and the last card/milestone until that shipping step.
