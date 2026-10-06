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

Implementation: shared DailyHeatmap for muscle/exercise HistorySheet.
The worktree is `codex/daily-history-calendar`, with simulator BOGA wt22 and Metro port 8104.

Evidence so far: `apps/mobile/artifacts/maestro/daily-history-calendar/native/startup.png`
confirms the native app boots. This shows Today, not a history calendar; it is
not a source-versus-implementation comparison and cannot establish visual acceptance.
The source is 853 × 1844 pixels, nominal 390 × 844pt. Native comparison viewport,
density normalization and history-state captures remain pending.

Findings:

- P2, fit: the eight columns currently retain 44pt minimum tile widths,
  requiring at least 352pt before gaps despite the read-only amendment. Standard phone
  widths use flexible gaps and 8pt body gutters. Narrower phones and unusually
  long figures still need an explicitly resolved fit rule. The proposed labelled
  row fallback and horizontal-scroll alternative are pending operator choice.
- Native UI access reports that the Mac is locked. It must be unlocked to
  inspect both history kinds and capture their metric, theme and edge states.
- The operator has not yet agreed the slower lane set required by AGENTS.md.

Required fidelity surfaces:

- Fonts/typography: source sizes map to existing Archivo/Plex Mono tokens;
  native hierarchy, full numeric figures and clipping are unverified.
- Spacing/layout rhythm: month framing and Monday–Sunday/Week order are tested;
  native small/large phone layout and scroll/dismissal are unverified.
- Colours/tokens: tile values reuse the existing adapter's independent heat and
  target levels; rendered themes and adjacent-month emphasis are unverified.
- Image quality/assets: the reference has no raster content assets to generate;
  the app's shared PageSheet supplies its existing dismissal control.
- Copy/content: tile numbers, blank rest, distinct zero/unknown/future states and
  accessible dates are covered by Jest. Native readability remains unverified.

Full-view and focused comparison evidence: missing. No comparison iteration or
visual pass is claimed.

Implementation checklist:

1. Resolve narrow/long-value fit and finish its layout/tests.
2. Run the operator-agreed iOS/quality lanes to green.
3. Capture both history kinds, supported metrics/themes, read-only tiles, rest/zero/
   unavailable, month/year boundaries and short/long windows on small/large phones.
4. Compare matching chart regions with the accepted reference, fix P0/P1/P2
   differences, and record intentional PageSheet/spacing deviations.
5. Update the target status and implementation PR with verified evidence.

final result: blocked
