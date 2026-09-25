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

- The tab strip is one card (`surface`, `rule`, card radius) floating in the
  tray, with four plain Archivo labels. The active tab is `ink` 700 over a 2pt
  `ink` underline, and the others are `ink-muted` 600. Tabs are navigation, so
  they are never `accent`.
- The tray handle is the sheet handle's recipe (38×4, `rule-strong`). The tray
  still drags and snaps, and collapsing it leaves only the handle.
- Every native stack header has a `surface` background, an Archivo 700 `ink`
  title and an `ink` back arrow, which matches the top bars the session view,
  exercise page and View Session draw.
- `Back to More` is a caps text button at the top left, not an outlined button.
- The auth guard's restore state is a centred `StatePanel` (a spinner and
  "Loading…") on `paper`.

## States

Device: iPhone simulator at 390pt width, light.

| Screenshot (lane) | State |
| --- | --- |
| `01-m26-today` … `04-m26-more` (`ios-smoke`) | each tab active in turn |
| `frame-tray-collapsed` (`ios-smoke`) | the tray collapsed to its handle |
| `05-m26-session-view-empty` (`ios-smoke`) | the tab strip on the session view |
| `02c-gyms-screen` (`ios-session-view`) | a native header, and `Back to More` |
| `04-data-runtime-smoke-success` (`ios-data-smoke`) | the Sessions header |
| `groups-07-friend-view-read-only` (`ios-groups-e2e`) | the group session header |

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
