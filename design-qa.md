# Design QA — session completion and sharing

Status: `passed`

## Comparison inputs

- Approved source: `/Users/sboschi/.codex/generated_images/01a09739-dfda-7012-9bbb-596d3ec79241/exec-7c64514d-366a-47c6-83ba-6c2d2748c35f.png` (`853 × 1844`).
- Large implementation: `apps/mobile/artifacts/maestro/ad-hoc/20260913-220812-17438/maestro-output/screenshots/session-completion-multiple-prs-all.png` and `session-share-preview-all-prs.png` (`1206 × 2622`, `402 × 874` points, 3×).
- Same-input comparison: `apps/mobile/artifacts/maestro/ad-hoc/20260913-220812-17438/design-qa-comparison.png` (source, in-app completion, and share preview side by side).
- Small implementation: `apps/mobile/artifacts/maestro/ad-hoc/20260913-221604-20823/maestro-output/screenshots/session-completion-multiple-prs-all.png` and `session-share-preview-all-prs.png` (`750 × 1334`, `375 × 667` points, 2×).

## States rendered

- Two simultaneous PRs in the completion presentation.
- Session totals with performed and working sets.
- Two exercise-volume comparisons with P5, median, P95, and in/out-of-range current markers.
- One-PR, no-PR, catalog-error/retry, and unmapped-muscle states.
- Session share preview, first-launch failure, retry, native image share sheet, cancellation, and analytics handoff.

## Visual comparison

- Hierarchy matches the approved direction: all compact PRs first, session summary second, exercise comparisons third, then session actions.
- PR cards remain distinct and readable without paging; both fit above the summary on the large and small evidence viewports.
- Exercise names and their performed/working-set counts share one compact heading; current volume and median comparison retain clear emphasis.
- P5/P95 endpoints, median tick, and current marker remain aligned and legible at both densities. Out-of-range state is stated in text, not color alone.
- The share sheet previews the exact card being captured. The small viewport scrolls the preview card while keeping privacy copy and actions reachable; capture dimensions retain the full card height.
- Spacing, typography, borders, success treatment, and primary action color use the existing BOGA design tokens. No clipping, overlap, unintended wrapping, or raw color literals were found.

## Discrepancy ledger

- P0: none.
- P1: none.
- P2: none.
- Accepted: the approved concept showed gym/location inside the share card; implementation intentionally omits it under the approved privacy contract while retaining gym in the in-app summary.
- Accepted: source examples included multiple PR categories; the current product contract awards strict estimated-1RM PRs only, so the fixture renders two records of that supported type.
- Accepted: native status/header chrome is present in simulator evidence because the production route owns it.

## Verification

- Large viewport: both focused Maestro flows passed.
- Small viewport: both focused Maestro flows passed.
- PNG capture reached the native share sheet after a retryable injected failure and cancelled without mutating session state.
