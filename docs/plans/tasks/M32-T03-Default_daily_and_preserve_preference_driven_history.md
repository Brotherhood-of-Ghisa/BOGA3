# M32-T03 — Default to Daily and preserve preference-driven history

- Status: `planned`
- Depends on: `M32-T01`; landed PR #497 baseline
- Milestone: `docs/plans/milestones/M32-progress-tables-and-individual-history.md`
- Areas: frontend preferences, heatmap integration; UI impact: yes

## Objective

Make Daily the default heatmap view while reusing the existing account-local
preference and Settings control. Keep all individual history entry points
preference-driven, retain Weekly, and eliminate family history from Progress.

## Scope

- In: preference default/fallback, existing sheet integration, individual target
  guards and tests, current history/settings contracts.
- Out: a second preference key/store, backend or sync persistence, replacement
  charts, new in-sheet Daily/Weekly controls, removing Weekly implementation.

## Decided

Milestone D4–D7 govern. Reuse the landed `heatmapView` model and Settings UI,
`HistorySheet`, `use-history`, DailyHeatmap and WeeklyHeatmap. PR #497 removed
the view toggle; keep that behaviour and test it. History metric choice remains
available. Preserve the same independent saved Working set/Volume eligibility
in both heatmap views; changing the view/default never changes calculation policy.

## Deliverables and acceptance

1. Missing, invalid and new-account view choices resolve to Daily. Persisted
   valid Daily or Weekly survives upgrade, restart and account switching; do
   not overwrite a valid explicit Weekly choice. Failed preference writes
   retain the existing durable value and retry semantics.
2. Every muscle/exercise sheet reads the same preference and saved look-back;
   there is no screen-local Weekly default or view toggle. A change in Settings
   takes effect on the next history opening/refocus without rebuilding the
   preference architecture or leaking choices across accounts.
3. WeeklyHeatmap and its adapter, interaction, accessibility and tests remain
   functional. Saved Weekly opens Weekly with its selection banner; unset
   choices open Daily with day details. Preserve mounted-view behaviour and
   ignored stale reads where the landed implementation relies on them.
4. Progress family headings cannot open history. Individual muscle targets
   contain exactly one ID; exercise targets use a definition ID. Guard against
   legacy multi-muscle target handoffs rather than silently treating a family
   as one muscle. Keep existing exercised daily/weekly metric behaviour.
5. Jest covers defaults/fallback, valid saved Weekly, settings roundtrip,
   isolation/sign-out, no view toggle, single-entity scope, no family action,
   loading/failed read/Retry, empty history and dismissal state restoration.
   Reuse real-data screen/preference tests; preserve weekly heatmap suites.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Daily by default | Open an individual name with no saved view | Daily heatmap, correct entity, saved look-back | Invalid storage falls back via existing diagnostics; unknown history stays unavailable |
| Saved Weekly | Choose Weekly in Settings, open an individual name | Existing weekly bars, selection/banner; no sheet toggle | Failed save retains durable choice; other account unchanged |
| Individual-only history | Press one muscle/exercise name; dismiss sheet | Correct ID; same underlying page state | Family label inert; rapid changes do not publish stale target data |

## Specs to update

- `docs/specs/ui/ux-rules.md`, `screen-map.md`, `navigation-contract.md`: Daily
  default, preference-owned view, individual-only history and dismissal.
- `apps/mobile/components/heatmaps/README.md`: retain both views and document the
  preference source without describing a retired in-sheet view toggle.
- `docs/specs/05-data-model.md`: only if the default description needs updating;
  keep the existing account-local, device-only boundary.

## Gates

Mandatory `fast`; UI default `frontend-ui`. Query `./boga test for` and agree the
smallest relevant simulator set or justified `covered-by-jest` lowering.
No new Maestro scenario without approval. Capture Daily and saved Weekly on
device against T01's target. Run `jest-coverage`, `complexity`, `dependencies`
before the PR. Delete this card and mark T03 completed in that PR.
