# Accepted target — the app frame (repo-native brief)

Target record per `../ai-design-policy.md`, for DLM-T02 of the design-language
migration. Chosen by the user on 2026-09-24 (plan decision G1 (a)): a brief in
this repository plus the gallery states the user accepts, because the frame is
built from the vocabulary `exercise-session-v5.md` already governs.
**Pending acceptance** in the DLM-T02 gallery.

## Target

- Vocabulary: `../design-language.md` (§2 roles, §3 type, §4 surfaces).
- This brief, plus the gallery states below. No artboards.

## Brief

- The tab strip is one card (`surface`, `rule`, card radius) on the `paper`
  ground, with four plain Archivo labels. The active tab is `ink` 700 over a 2pt
  `ink` underline, and the others are `ink-muted` 600. Tabs are navigation, so
  they are never `accent`.
- The bar is fixed and the same on every screen that shows it (the tab
  screens, the session view, exercise history). The collapsible tray and its
  handle were removed on operator review, 2026-10-05: the bar changed style
  between Progress and a workout.
- Every native stack header has a `surface` background, an Archivo 700 `ink`
  title and an `ink` back arrow, which matches the top bars the session view,
  exercise page and View Session draw.
- `Back to More` is a `chevron-left` icon button at the top left.
- The auth guard's restore state is a centred `StatePanel` (a spinner and
  "Loading…") on `paper`.

## States

Device: iPhone simulator at 390pt width, light.

| Screenshot (lane) | State |
| --- | --- |
| `01-m26-today` … `04-m26-more` (`ios-smoke`) | each tab active in turn |
| `05-m26-session-view-empty` (`ios-smoke`) | the tab strip on the session view |
| `02c-gyms-screen` (`ios-session-view`) | a native header, and `Back to More` |
| `04-data-runtime-smoke-success` (ad hoc) | the Sessions header |
| `groups-07-friend-view-read-only` (`ios-groups-e2e`) | the group session header |

`(ad hoc)` states are no longer captured by a lane: their flow keeps only
the claims that need a device (spec 06, "Maestro scope policy") and Jest
proves the rest. When the screen changes, capture them with a one-off flow
run (`apps/mobile/scripts/maestro-ios-run-flow.sh --flow …`); git history
holds the flow steps that reached them.

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
