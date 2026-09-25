# Accepted target — Today and Train (repo-native brief)

Target record per `../ai-design-policy.md`, for DLM-T03 of the design-language
migration. Chosen by the user on 2026-09-24 (plan decision G1 (a)): a brief plus
the gallery states the user accepts. **Pending acceptance** in the DLM-T03
gallery.

## Target

- Vocabulary: `../design-language.md` and the app frame (`app-frame.md`).
- This brief, plus the gallery states below. No artboards.

## Brief

- The page is `paper` under a `PageHeader` (Archivo 800 title, `ink-muted`
  intro). Each section has a `SectionHeader`, and its link ("View groups",
  "View progress") is a caps text button.
- An active workout is a `Card` marked by the `set-current` ring and the words
  "Active session" or "Continue your active session", with no green.
  `Resume workout` is the screen's one `accent`.
- Train shows one `accent` at a time. When a plan is ready, `Start planned
  workout` is the primary and `Start empty workout` is an outline (T03-D1).
- Recent sessions are one `Card` of hairline `ListRow`s. Each row is the
  session summary line (figures in Plex Mono) with a chevron.
- Loading, empty, error and unavailable states are `StatePanel`s inside cards,
  with their copy kept, including "Watch this space 👀".
- Today's group-activity items are the Groups stream's cards and panels,
  restyled with the Groups tab (DLM-T11, `groups.md`).

## States

Device: iPhone simulator at 390pt width, light.

| Screenshot (lane) | State |
| --- | --- |
| `01-m26-today` (`ios-smoke`) | Today, idle: planning placeholder, signed-out group panel, no sessions |
| `today-active-workout` (`ios-smoke`) | Today with a workout running |
| `02-m26-train` (`ios-smoke`) | Train, idle: empty start (primary) and the planning placeholder |
| `train-active-workout` (`ios-smoke`) | Train with a workout running |
| `02-abandoned-back-on-train` (`ios-session-view`) | Train after an abandon |
| `today-recents` (`ios-session-view`) | Today listing a finished session |
| `17-first-run-roundtrip-bootstrapped` (`ios-sync-e2e`) | Today signed in, after the first sync |
| `groups-07c-0-today-record` (`ios-groups-e2e`) | Today with group activity |

Jest only (no harness seam reaches them): the plan loading, error and ready
states, and the recents load error.

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
