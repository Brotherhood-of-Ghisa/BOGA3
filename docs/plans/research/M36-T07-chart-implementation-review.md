# T07 implemented chart — review handoff

Status: implementation prepared on the T06 experimental branch; human review and the T07 UI-lane agreement remain pending. Main is untouched. This is not full T07 acceptance, T08 acceptance or production exposure.

## Build and review inputs

The approved [native r1 target](../designs/M36-T05-rm-chart-review.md) governs the first release. The separate two-curve concept remains excluded. The implementation consumes T06's production read model and adopted estimator; it imports no research regression or breakpoint tooling.

`apps/mobile/components/rm-curve/` owns the reusable page body, connected screen, SVG chart, geometry and details. The host supplies the selected exercise and a stable focus-time instant; native header/Back and production navigation belong to T09. No `app/` file, root stack, entry link, schema or metric rule changed. The canonical frozen input/oracle is unchanged. T06 and T07 reuse one migrated-SQLite seed helper.

The implemented scope controls select exercise, gym, bounded History range and known RIR. Selection has no initial default; a still-visible ID survives scope changes, removed IDs clear without resurrection, and exercise/account changes clear it. Coincident/nearby marks open an ordered chooser; every set remains available through a virtualized dated list. List/announcement values include actual reps, RIR, equivalent reps, Load, Weight, ordinary 1RM and per-side units. Loading/error hides retained chart/details; Retry retains filters. Sparse/zero/high-RIR, missing/unknown effort, no reference, empty filters and unavailable exercise have distinct presentation.

## Concrete design reconciliation to review

- The brief says bounds include zero; its HTML screenshots instead zoom ordinary loads to roughly 60–110 kg and reps to 1–13. The implemented axes include zero and the full inherited integer-knot reference through at least 20 reps. This exposes more of the reference but compresses the point cloud. Human review must accept these bounds or request the target's tighter zoom before acceptance testing.
- Existing `formatWeight` preserves entered precision; the prototype shortened synthetic values to two decimals. The implementation preserves repository formats, including long synthetic decimals. Numbers wrap on small screens; recorded values never change.
- `copy.no-inline-explanation` excludes the prototype's rule footnotes. The implementation puts bodyweight meaning in the Load label and shows exclusion counts only. Existing fixed-font policy remains in force. Control rows, sheet gestures, disabled actions and surfaces use house primitives.
- The developer toolbar and weekly replay controls are outside the component and remain ignored review tools. No production weekly replay, detector, confidence band, fitted weekly overlay or second curve is added.

## Verification and local evidence

Component/geometry checks reuse all 24 frozen prefixes for plateau/stable/smooth controls, render the six repeated-exposure/load-step weeks, verify existing 1RM versus analytical coordinates, direct/coincident and coordinate-free access, selection retention/clearing, sparse/no-reference/zero/high-RIR, failure/retry and clamped scopes. Connected screen tests read real migrated SQLite and catalogue/preferences, including bodyweight/per-side labels, date preference changes, deletion and local-write refresh. A final regression keeps the chart's durable History bound available when unrelated preference validation fails; a house Notice/Retry follows existing History behavior. No remote export or statistical suite was repeated.

Evidence remains under the ignored `apps/mobile/artifacts/review/rm-curve/` directory: raw gate logs, independent `review.txt`, state/theme JSON, screenshots and the developer-only preview entry/bundler. The browser preview renders the actual RN components through installed React Native Web, with shipped fonts and production theme roles; it is not a separately drawn HTML chart. A web-only theme-storage adapter and the normal worklet transform allow that isolated build. Browser viewport evidence is not native acceptance.

The isolated iOS simulator/client booted with `./boga ios start`. Following the operator's direction to work while the Mac stays locked, existing BoGa URL-scheme/dev-menu preauthorization and a restart of that simulator removed the pending development-client prompt. The ignored entry renders actual components and uses the frozen synthetic fixture, copied unchanged outside Metro's excluded test directory. `simctl` captures verify native main/sparse/no-reference/mixed-effort/missing-effort/empty/loading/error/unavailable/bodyweight/zero/high-RIR states and six plateau prefixes. The local `review-gallery.html` presents these alongside the target and actual browser selected-set capture. VoiceOver, native selection/gesture/focus behavior and UI acceptance remain unverified. `./boga doctor` passed. Temporary package entry changes were restored; no preview route is committed.

Lane defaults for the T07 delta are `fast`, `frontend-ui` and `docs-check`. The previously agreed fast/coverage/complexity/dependencies/docs checks are retained. A T07-specific proposal to defer unreachable Maestro acceptance flows to T08 is pending operator agreement; no new Maestro flow was created. Human approval of the implemented result remains required before acceptance runs.

Final local source evidence: fast PASS (284 suites / 3,909 tests plus aggregate checks); jest-coverage PASS (86.48% branches / 94.40% lines); complexity PASS; dependencies PASS (524 modules / 2,631 dependencies, 13 existing known violations unchanged). These runs include the final preference-error fix. No duration is asserted. Final docs-check PASS is recorded separately in `docs-check.log`.

Independent source re-review is clean: all eight source findings were fixed with regressions; the preference Notice fix was re-reviewed; product REVIEW verdict clean. The reviewer inspected representative browser captures and author logs, without duplicate lane execution. The eight fixes covered caret headroom, copy, gym/range labels, coordinate-free activation/focus origin, overlap-list work, empty-filter wording and per-side accessibility units. Browser interaction additionally proved set selection and found/fixed web focus and scroll-coordinate handling. Native rendering review is recorded in the same ignored review artifact.

Human visual review, the T07 UI-lane narrowing agreement and native acceptance remain pending. A proposal, branch commit or passing source review alone does not complete T07.
