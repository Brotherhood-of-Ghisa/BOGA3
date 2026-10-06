# Daily history calendar design QA

Source visual truth: `docs/specs/ui/design-targets/daily-history-calendar/reference.png`.
The target record governs chart content; `docs/specs/ui/design-targets/history-popup.md`
governs the native PageSheet header and dismissal.
The operator's 2026-10-06 read-only amendment supersedes the reference's black
selection/current outlines. Daily day and Week tiles now expose text without
press actions; only the separate Weekly view retains selection.
The operator's metric-colour amendment also supersedes the reference's black
active metric fill: HistorySheet now uses theme `accent` with `surface` text.
The existing palette gates that pair at ≥4.5:1 for all presets and custom hues.
Latest revision validation (read-only tiles and themed metrics, rebased onto main):
`./boga test fast` passed, including 237 Jest suites / 3,019 tests, lint, typecheck, UI guardrails, backend smoke, docs/meta
checks and consent/MCP checks. Log:
`apps/mobile/artifacts/maestro/daily-history-calendar/fast-pr.log`.

Operator agreed the focused lane set on 2026-10-06: fast, ios-data-smoke,
jest-coverage, complexity and dependencies. The full frontend-ui default was
lowered to its existing history flow; no new Maestro scenario was added.

Finished-change gate evidence:

| Gate | Result | Local artifact |
| --- | --- | --- |
| fast | PASS; 237 suites / 3,019 tests | `apps/mobile/artifacts/maestro/daily-history-calendar/fast-pr.log` |
| jest-coverage | PASS; 87.04% branches, 94.68% lines | `apps/mobile/artifacts/maestro/daily-history-calendar/jest-coverage.log` |
| complexity | PASS; no new suppressions | `apps/mobile/artifacts/maestro/daily-history-calendar/complexity.log` |
| dependencies | PASS; no new violations; 444 modules / 2,119 dependencies | `apps/mobile/artifacts/maestro/daily-history-calendar/dependencies.log` |
| ios-data-smoke | PASS; all 3 existing flows | `apps/mobile/artifacts/maestro/daily-history-calendar/ios-data-smoke.log` |

Native gate artifacts: `apps/mobile/artifacts/maestro/ad-hoc/20261006-175721-21677`.

Implementation: shared DailyHeatmap for muscle/exercise HistorySheet.
The worktree is `codex/daily-history-calendar`, with simulator BOGA wt22 and Metro port 8104.

Native screenshots were inspected from the data-runtime-smoke flow:
`apps/mobile/artifacts/maestro/ad-hoc/20261006-175721-21677/data-runtime-smoke/maestro-output/2026-10-06_175755/data-runtime-smoke/takeScreenshot/06-history-short-drag-restored.png`
and `apps/mobile/artifacts/maestro/ad-hoc/20261006-175721-21677/data-runtime-smoke/maestro-output/2026-10-06_175755/data-runtime-smoke/takeScreenshot/07-history-chart-scrolled.png`. They show
exercise Sets in Warm: theme-accent selection, no black tile outlines, the
eight calendar columns and body scrolling under the fixed header. The flow
also proves short-drag recovery and native swipe dismissal.
The source is 853 × 1844 pixels, nominal 390 × 844pt; native captures are
1206 × 2622 pixels. These differ in viewport, metric and data, so they provide
partial native evidence rather than a matched source comparison or full acceptance.

Findings:

- P2, fit: the eight columns currently retain 44pt minimum tile widths,
  requiring at least 352pt before gaps despite the read-only amendment. Standard phone
  widths use flexible gaps and 8pt body gutters. Narrower phones and unusually
  long figures still need an explicitly resolved fit rule. The proposed labelled
  row fallback and horizontal-scroll alternative are pending operator choice.
- The last manual native UI check reported a locked Mac. The agreed CLI smoke
  lane ran successfully; the remaining muscle/metric/theme/size matrix and
  matched comparison have not been captured.

Required fidelity surfaces:

- Fonts/typography: source sizes map to existing Archivo/Plex Mono tokens;
  native hierarchy, full numeric figures and clipping are unverified.
- Spacing/layout rhythm: month framing and Monday–Sunday/Week order are tested;
  native scroll/dismissal passed. Small/large phone layout remains unverified.
- Colours/tokens: tile values reuse the existing adapter's independent heat and
  target levels; rendered themes and adjacent-month emphasis are unverified.
- Image quality/assets: the reference has no raster content assets to generate;
  the app's shared PageSheet supplies its existing dismissal control.
- Copy/content: tile numbers, blank rest, distinct zero/unknown/future states and
  accessible dates are covered by Jest. Native readability remains unverified.

Full-view and focused matching comparison evidence: missing. The inspected
exercise Sets screenshots are a partial review; no full visual pass is claimed.

Implementation checklist:

1. Resolve narrow/long-value fit and finish its layout/tests.
2. Operator-agreed iOS/quality lanes are green; retain their evidence in the PR.
3. Capture both history kinds, supported metrics/themes, read-only tiles, rest/zero/
   unavailable, month/year boundaries and short/long windows on small/large phones.
4. Compare matching chart regions with the accepted reference, fix P0/P1/P2
   differences, and record intentional PageSheet/spacing deviations.
5. Update the target status and implementation PR with verified evidence.

## PR repair verification (2026-10-06)

Merged the current main branch and combined the concurrent SegmentedControl
extensions into `selectedGround`: History keeps accent/surface selection and
Progress keeps viz/ink selection. Both Jest cases are retained.
Pinned the MCP SDK to 1.32.1 to clear
[GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h).

`./boga test fast` passed on the combined revision: 237 Jest suites / 3,024
tests, local backend smoke, docs/meta, consent checks, and MCP audit (zero
vulnerabilities), typecheck, 13 unit tests and production build. Local log:
`apps/mobile/artifacts/maestro/daily-history-calendar/pr-578-repair/fast.log`.
Operator approved the repair set on 2026-10-06: fast, mcp-smoke, jest-coverage,
complexity and dependencies. The colour API merge is covered by Jest, retaining
both History and Progress selection contracts; no simulator lane was repeated.

| Repair gate | Result | Local artifact |
| --- | --- | --- |
| mcp-smoke | PASS; discovery, consent, refresh, rejected-token challenge and all four tool calls through the real agent API | `apps/mobile/artifacts/maestro/daily-history-calendar/pr-578-repair/mcp-smoke.log` |
| jest-coverage | PASS; 237 suites / 3,024 tests, 87.04% branches, 94.68% lines | `apps/mobile/artifacts/maestro/daily-history-calendar/pr-578-repair/jest-coverage.log` |
| complexity | PASS; no new suppressions | `apps/mobile/artifacts/maestro/daily-history-calendar/pr-578-repair/complexity.log` |
| dependencies | PASS; no new violations, 444 modules / 2,119 dependencies | `apps/mobile/artifacts/maestro/daily-history-calendar/pr-578-repair/dependencies.log` |

Earlier iOS results above predate this merge. The outstanding visual acceptance
findings remain open.

final result: blocked
