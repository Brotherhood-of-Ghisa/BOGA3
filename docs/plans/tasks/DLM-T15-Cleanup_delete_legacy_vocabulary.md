---
task_id: DLM-T15-Cleanup_delete_legacy_vocabulary
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "no visible change (deletion + guard + docs)"
areas: "frontend|docs"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{design-language,ux-rules,components-catalog,README}.md, docs/specs/03-technical-architecture.md, docs/specs/08-ux-delivery-standard.md (if any legacy mention remains), apps/mobile/app/__tests__/README.md, docs/plans/design-language-migration.md (deleted), docs/plans/tasks/DLM-* (deleted)"
---

# DLM-T15 Cleanup: delete the legacy vocabulary, guard against its return, one set of docs

- Status: `planned`, **approved 2026-09-24** (decisions as recommended). **Mandatory**: the plan is not done
  until this merges.
- Depends on: **every** card T01–T14 merged to `main`.
- Design target: none. There is no visible change.

## Objective

Leave the mobile app with **one styling vocabulary**. Delete the legacy exports.
Add a guard that fails the build if any legacy name comes back. Rewrite the
docs so nothing describes two languages. Delete this plan and its cards.

## Scope

1. **Re-measure first.**
   `grep -rnE '\b(uiColors|uiRadius|uiElevation|UiText|UiSurface|UiButton|SegmentedChips|UiColorToken|UiRadiusToken|UiElevationToken|UiTextVariant|UiSurfaceVariant|UiButtonVariant)\b' apps/mobile/{app,components,src}`,
   excluding `components/ui/{tokens,index,text,surface,button,segmented-chips}.ts(x)`,
   must be empty before this card starts. If it is not, the leftover belongs to
   the card that owned that file: fix it there, or fold a mechanical swap in
   here and say so in the PR.
2. **Delete:**
   - `components/ui/{text,surface,button,segmented-chips}.tsx`;
   - `uiColors`, `uiRadius` and their types from `tokens.ts`;
   - the `colors` / `radius` keys of `uiTokens` (and `uiTokens` itself if
     nothing reads it: measured, only `components/ui` did);
   - the matching `index.ts` exports;
   - `app/__tests__/ui-primitives.test.tsx` and its snapshot, whose only
     remaining cases are the legacy primitives (T02 moved `MainTabs` out).
3. **Guard** (`scripts/check-ui-guardrails.js` + `ui-guardrails.config.js`): a
   new zero-tolerance rule, `legacyVocabulary`.
   - It scans `app/**`, `components/**` **and `src/**`**, for `.ts` **and
     `.tsx`**, excluding tests. This is wider than the existing rules, because
     legacy use lived in `.ts` files (`screen-styles.ts`, `heatmap-metric.ts`)
     and in `src/sync/SyncGate.tsx`.
   - It matches the identifiers in step 1 as whole words, plus
     `uiTokens.(colors|radius|elevation)`.
   - It has no allowlist and no budget (it blocks on sight, like
     `rawColorLiteralRule`).
   - The remedy text names the replacements: `uiRoles`, `uiGeometry.radius`,
     `Card` / `Stat` / `ListRow` / `ActionButton` / `SegmentedControl` /
     `ChipGroup`.
   - `ui-guardrails-script.test.ts` gains the rule's cases: flags each name in
     `.ts` and `.tsx` under all three roots; ignores tests; ignores a name inside
     a longer identifier (`myUiColorsHelper`).
   - Also: `rawRadius`'s remedy (`check-ui-guardrails.js:43`) says "use
     `uiGeometry.radius.*`".
4. **Token gate** (`ui-design-tokens.test.ts`):
   - `import * as tokens from '@/components/ui/tokens'` has no `uiColors`,
     `uiRadius` or `uiElevation`;
   - `uiTokens`, if kept, has exactly the design-language keys;
   - the file's header comment drops "the legacy scales".
5. **Docs: one vocabulary.**
   - `design-language.md`:
     - the status line becomes "Current behavior" for the whole app;
     - §3's "Screens not yet in the design language still render in the system
       font" is deleted;
     - §4's "beside the legacy `uiRadius` / `uiSpace`… retired wholesale" is
       deleted, and `uiSpace` stays, as the one spacing scale.
   - `ux-rules.md`:
     - §9 remedies name `uiGeometry.radius`;
     - §9a is rewritten as "the token scales" with one set (`uiRoles`,
       `uiFonts`, `uiGeometry` incl. radii `card 6 · sheet 16 · control 4 ·
       pill 999`, `uiSpace`, `uiTypography`, `uiIconSize`, `uiBorder`, the
       `viz` roles), dropping "second, separate vocabulary", "rule 5's three
       radii" and the elevation text;
     - §9a.3's "`xs` (11) on everything shipped before 2026-09-22" is deleted;
     - §9b.1 "`uiColors` carries no dark variants" → `uiRoles`;
     - §9c.3 → `uiRoles` only;
     - "Pending / planned" 1–3, which name `T-20260226-06`, are removed or
       replaced by whatever is still genuinely pending.
   - `components-catalog.md`:
     - delete entries 2–5 (`UiText`, `UiSurface`, `UiButton`,
       `SegmentedChips`), entry 1's legacy bullets (the "semantic/status/overlay
       palette", the "green family and warm … palettes", the collapsed-scales
       sentence) and **"Refactor convergence notes"**;
     - fix the stale `components/muscle-analytics/` location (the folder does
       not exist);
     - reconcile "Pending / planned".
   - `03-technical-architecture.md:41` (the light-theme row): "`uiColors` has
     no dark variants" → "`uiRoles` has no dark variants", and its Source
     column is unchanged. `:44` (the guardrail ratchet row) gains the
     `legacyVocabulary` rule in one clause.
   - `ui/README.md`: `design-language.md`'s bundle-map line drops "(status
     `Pending / planned`)".
   - `apps/mobile/app/__tests__/README.md`: the `uiRadius` / `uiElevation`
     mention.
   - A final `grep -rnE 'uiColors|uiRadius|uiElevation|UiText|UiSurface|UiButton|SegmentedChips' docs/specs AGENTS.md RUNBOOK.md apps/mobile/*.md apps/mobile/app/__tests__/README.md`
     returns nothing, or only lines that explicitly record the retirement.
6. **Delete** `docs/plans/design-language-migration.md` and every remaining
   `docs/plans/tasks/DLM-*` card.

Out: any visual change. If the full frontend gate shows a screenshot
difference, that is a bug in an earlier card, not something to fix here
silently.

## Acceptance criteria

1. **Zero references** in `apps/mobile` (`app`, `components`, `src`, tests
   included) to `uiColors`, `uiRadius`, `uiElevation`, `UiText`, `UiSurface`,
   `UiButton` or the legacy `SegmentedChips`. Their files and exports are
   deleted from `components/ui/`.
2. **The guard fails if any comes back:** `legacyVocabulary` in
   `check-ui-guardrails.js` (run by the `ui-guardrails` lane and in CI), proven
   by `ui-guardrails-script.test.ts`, plus the non-export assertion in
   `ui-design-tokens.test.ts`.
3. **One vocabulary in the docs:**
   - `ui-design-tokens.test.ts`, `design-language.md` and `ux-rules.md` §9a
     describe only the design-language tokens;
   - the `ux-rules` §9 legacy notes, the `components-catalog` legacy entries and
     "Refactor convergence notes", and the `03` row naming `uiColors` are
     updated or removed;
   - the docs grep in step 5 is clean.
4. **Every screenshot flow is green:** `./boga test fast` and the full
   `./boga test frontend` (smoke, data-smoke, ui-regression, exercise-page,
   session-view, auth-profile, sync e2e, groups e2e), with evidence paths in the
   PR. Spot-check captures against the accepted galleries: none may differ.
5. **The plan and all DLM cards are deleted.**

## Gates

`./boga test fast` + `./boga test frontend` (`./boga test for`: "UI
components"; the doc edits add `docs-check`, inside `fast`).

## Estimate

About 900 lines, mostly deletions (the four primitives, 62 colour keys, the
legacy test and snapshot, doc sections). New code is the guard rule and its
tests, about 150 lines.
