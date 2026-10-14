# T08 integrated chart — review handoff

Status: validation prepared on the T07 experimental branch; native interaction-scenario approval, human hands-on acceptance and the final device suite remain pending. T08 is not complete. T07 is delivered in draft PR #739; main is untouched.

## Scope and target

The operator directed proceeding to T08 on 2026-10-14 after the concrete [T07 review](M36-T07-chart-implementation-review.md). Retain the accepted zero/full-reference bounds and repository formats/copy. The [approved r1 target](../designs/M36-T05-rm-chart-review.md) still governs; no production component, route, navigation, schema, formula or loading rule changed in this task.

The branch delta adds six integration tests in `apps/mobile/__tests__/rm-curve-integration.test.tsx`. All successful reads use migrated SQLite and the real repository/hook/component; only an unseedable storage failure is injected. The existing frozen input, oracle and shared seed helper remain unchanged. No remote export, statistical fit or numerical validation suite was repeated.

## Validation map

| Claim | Evidence and boundary |
| --- | --- |
| Storage failure/retry | Connected screen hides stale plot/details, retains scopes and restores the exact date/block/set selection; raw set rows are unchanged. |
| Cohort changes | Newest Unspecified gym remains separate; gym/RIR changes update observations and reference together. RIR4 observations retain the scatter with no invented prior curve. |
| Dated bodyweight refresh | Selected per-side readout changes after an earlier reading edit; deleting it restores the existing personal fallback. An independent 1.25 kg coordinate difference is asserted; logged sets remain unchanged. |
| Weekly controls | Plateau/stable/smooth prefix views at weeks2/14/22 read through SQLite and match frozen counts, reference100, actual reps/RIR, Weight/ordinary 1RM and equivalent-reps/Load. Earlier full-prefix arithmetic/race/rendering proofs remain T06/T07 evidence. |
| Dense/sparse and eligibility matrix | Reuse T06 reader and T07 rendering proofs for repeated blocks, missing/unknown/high RIR, zeros/invalid/planned/deleted rows, source metadata and empty/no-reference states. |
| Native data/runtime | Actual connected screen runs over native `expo-sqlite` and the shipped migrations, using a compiled copy of the existing seed helper and a byte-identical frozen input. Native hierarchy is read-only evidence; no acceptance flow has run. |

## Native preview and human review

The isolated slot57 simulator is `BOGA wt57` on pinned iOS27. The ignored preview entry supplies the existing gesture/safe-area providers and real connected screen; temporary package entry changes were restored. Initial preparation now bootstraps the database before using its existing reset API. Preview controls/captions belong to the review tool, outside production content.

Native captures cover the normal product12-week window, nine SQLite variants (sparse, no reference, mixed/missing effort, empty, unavailable, bodyweight, zero, high RIR), six plateau prefixes2/6/10/14/18/22 and stable/smooth controls. The product window's reference101.3 is coherent with its different prior cutoff; the separately pinned prefix view retains reference100. No weekly fit, detector or second line is introduced. Dataset variants are declared synthetic fixture mutations, not changes to the canonical input.

Evidence is ignored under `apps/mobile/artifacts/review/rm-curve-integration/`: input-check, native screenshots/hierarchies, preview sources and gate/review logs. The native viewport is402×874; unchanged small/large layout evidence from T07 is retained, while native interactions at those sizes remain unverified. The CLI's old Studio interface is no longer bundled; no additional software was installed. Existing native CLI capability works while the Mac is locked.

The [local review gallery](http://127.0.0.1:8757/review-gallery.html) presents those captures, week selectors and gate logs. Its controls switch screenshots only. For hands-on review, use the running `BOGA wt57` preview: tap a mark, inspect coincident sets and exact readouts, use View sets and its chronological list, change gym/effort/range/exercise, and dismiss sheets. Native touch coordinates, scroll reach, sheet gestures and VoiceOver/focus/announcements still need verification. The proposed single chart-only Maestro scenario is justified by those device-only behaviors; explicit approval is pending before it is written. T09 owns the new entry/Back/context proof and must reuse unchanged chart evidence.

## Source checks and review

Author evidence: fast PASS (285 suites / 3,915 tests plus aggregate checks); coverage PASS (86.51% branches / 94.40% lines); complexity PASS; dependencies PASS (524 modules / 2,631 dependencies, 13 known unchanged). The five-lane source/quality/docs agreement is retained. Actual changed-path defaults for this test-only delta are fast; native acceptance is an additional proposal. Docs-check PASS after this metadata closeout; its log is retained with the other evidence. No duration is asserted.

Independent review is clean; two initial assertion gaps were fixed: exact selected identity after Retry and exact frozen prefix load/ordinary 1RM. Product REVIEW verdict clean. The reviewer inspected the expanded native matrix and author logs without duplicating lanes. Renderer evidence does not establish native interaction, VoiceOver or human acceptance. Keep the card in_progress until the remaining gates are fulfilled; no T09 work or merge is authorized.
