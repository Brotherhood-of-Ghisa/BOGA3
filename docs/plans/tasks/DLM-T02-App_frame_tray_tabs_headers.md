---
task_id: DLM-T02-App_frame_tray_tabs_headers
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{components-catalog,ux-rules,navigation-contract}.md, docs/specs/ui/design-targets/app-frame.md (new)"
---

# DLM-T02 App frame: tab tray, tabs, stack headers

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: T01. T03–T14 depend on this card, because every gallery shows the
  frame.
- Design target (G1): brief + gallery → `design-targets/app-frame.md`.

## Objective

Restyle the chrome every screen sits in:

- the collapsible tab tray (`BottomTray`) and its four tabs (`MainTabs`);
- the native stack header on every stack route (G4 (a));
- the `Back to More` button;
- the auth guard's loading panel.

Behaviour is unchanged: tray snapping, tab order, labels, routes, testIDs, and
the back and title behaviour.

## Today → becomes

| Today (file:line) | Becomes |
| --- | --- |
| `MainTabs`: a `UiSurface` shell (`borderMuted`, `surfaceDefault`, `radius md`) of four boxed `UiButton variant="tab"` chips on `surfacePage`. The active tab is blue `actionPrimary` bold, with no fill change (`main-tabs.tsx:39-44`, `text.tsx:94-98`) | A `surface` strip with a top `rule` hairline and no box per tab. Labels are Archivo 600 in `ink-muted`; the active tab is Archivo 700 in `ink` over a 2px `ink` indicator. `accent` is not used, since tabs are navigation, not the primary action (`ux-rules` §1.4). `tablist` / `tab` / `selected` and `top-level-tab-*` are kept |
| `BottomTray` handle: `borderInputStrong` pill, `uiRadius.full` (`bottom-tray.tsx:258-264`) | The sheet handle's recipe: 38×4, `ruleStrong`, `radius.pill`. The drag and snap maths are unchanged |
| Native stack header: platform default (white or blur, system font, blue back tint); `ROOT_STACK_SCREEN_OPTIONS = { headerBackButtonDisplayMode: 'minimal' }` (`app/_layout.tsx:26`) | `headerStyle: { backgroundColor: paper }`, `headerShadowVisible: false`, `headerTitleStyle` Archivo 700 `ink`, `headerTintColor: ink`, with the minimal back display kept. Every stack route inherits it, including Gyms and the group session view (already DL, whose headers change here) |
| `MoreHubBackButton`: a secondary `UiButton` "Back to More" (`more-hub-back-button.tsx:26-33`) | `ActionButton variant="text"` with a leading `chevron-left`, left-aligned. `back-to-more-button` and the `source=more`-only rendering are kept |
| `AuthRouteGuard` loading: spinner `textPrimary` + "Loading…" on `surfacePage` (`auth-route-guard.tsx:40-71`) | `StatePanel kind="loading"` on `Screen`. `auth-guard-loading` is kept |

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| T02-D1 | Tab icons: today the tabs are text only. Add a glyph per tab (Lucide `sun`, `dumbbell`, `chart-column`, `ellipsis`)? | **No**, not in a restyle: it is a new visual element and would need its own target. Text tabs in the design-language type stay the minimum change. Offered as a follow-up |
| T02-D2 | The active-tab mark: a 2px `ink` indicator above the label, or weight only? | **Indicator + weight.** Weight alone is too subtle at 12–13pt, and the indicator carries state without colour |
| T02-D3 | The header background on the design-language screens that already draw their own top bar (session view, exercise page, View Session) | Unaffected: they set `headerShown: false` |

## UX contract

- **Switch tabs.** Trigger: a tab tap. Success: the tab becomes active (indicator
  plus weight, `selected`) and the route changes, as today. Edge: an unknown
  route leaves no tab selected (the model's `null` fallback).
- **Collapse and expand the tray.** Trigger: drag or tap the handle. Success: it
  snaps, as today.
- **Stack back.** Trigger: the header back on any stack route. Success: it pops
  with the minimal back label, now in `ink`.

## Gallery

- Existing captures (before and after): `01-m26-today`, `02-m26-train`,
  `03-m26-progress`, `04-m26-more` (smoke), `02c-gyms-screen` (session-view
  lane, native header + Back to More), `04-data-runtime-smoke-success`
  (Sessions header), `groups-07-friend-view-read-only` (group session header).
- **New:** `frame-tray-collapsed` (smoke-launch: tap `bottom-tray-handle`,
  assert `bottom-tray-body` hidden, capture, tap again).

## Tests

- `root-layout-auth-bootstrap.test.tsx:140` asserts `screenOptions` equal to
  `{ headerBackButtonDisplayMode: 'minimal' }`. Extend the expectation to the new
  options, imported from one exported constant.
- `ui-primitives.test.tsx:67-72` snapshots `MainTabs` with legacy colours.
  **Move** that case to a new `main-tabs.test.tsx` behaviour assertion (active
  `selected`, the indicator present only on the active tab). Delete the snapshot
  entry. The legacy file keeps only the legacy primitives until T15.
- `main-tabs.test.tsx` and `groups-screens.test.tsx:597-600`: unchanged (role
  and selected state).

## Docs

- `components-catalog.md` specialized 1–3 (`BottomTray`, `MainTabs`,
  `MoreHubBackButton`): the new look in one line each.
- `ux-rules.md` §1.4: tabs use an `ink` indicator and weight, not colour.
- `navigation-contract.md` "Header titles": the headers' one style, set in
  `app/_layout.tsx`.
- `design-targets/app-frame.md`: new, with the accepted states.

## Gates

`./boga test fast` + `./boga test frontend`.

## Acceptance

1. No `uiColors`, `uiRadius`, `UiButton` or `UiSurface` in
   `components/navigation/**`.
2. Every stack route's header renders in the one style (captures above).
3. Gallery accepted; `app-frame.md` records it.
4. Estimate: about 500 lines.
