---
task_id: DLM-T04-More_Settings_Logs
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{screen-map,ux-rules,components-catalog}.md, docs/specs/ui/design-targets/more-settings.md (new)"
---

# DLM-T04 More, Settings, Logs (and the Maestro harness)

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: T01, T02.
- Design target (G1): brief + gallery → `design-targets/more-settings.md`. Logs,
  Developer tools and the harness are captured for information only (G8).
- Files: `app/(tabs)/more.tsx` (168), `app/(tabs)/settings.tsx` (543),
  `components/sync-status/sync-status-panel.tsx` (194), `app/dev-logs.tsx`
  (205), `app/maestro-harness.tsx` (200).

## Today → becomes

### More

| Today (line) | Becomes |
| --- | --- |
| Title + intro; sections (Community, Tools, Library & account) of one `UiSurface` card per destination; **info-blue icon badges** (`surfaceInfo` + `actionPrimary` icon, :155-158); chevron or `arrow-up-right` in `textSecondary` | Title and intro as Today (T03). Each section is a micro-label and **one `Card` of `ListRow`s**: a leading glyph in `ink-muted` (no badge, G3), the label and description, and a trailing `chevron-right` or `arrow-up-right`. testIDs such as `more-settings-row` are kept |
| Connect-agent inline error in `actionDangerText` (:165) | `danger` text under the row, keeping `more-connect-agent-error` |

### Settings

| Today (line) | Becomes |
| --- | --- |
| `MoreHubBackButton`, title | As restyled in T02; title as More |
| Account row (email), AI coaching (description, link row, error, Connected agents row) | `Card`s of `ListRow`s, as More. `settings-profile-row` and `settings-connected-agents-row` are kept |
| Preferences: date format, 3 pill buttons, blue-selected (:514-534) | `SegmentedControl` with `testIDPrefix="settings-date-format"`, so `settings-date-format-<fmt>` and `selected` are kept |
| Data & sync: `SyncStatusPanel` or the signed-out card | See the panel below; the signed-out card becomes a `StatePanel kind="message"` inside a `Card` (`settings-sync-status-signed-out-card` kept) |
| About: `surfaceMuted` card with version, release and flavor | A `Card` of `Stat kind="text"` rows (`settings-about-*` testIDs and the copy "Version 1.2.3 (build 45)" etc. kept) |
| Developer tools: **`surfaceWarning` card** (:486); secondary View logs / Reset / Wipe local; **danger** Wipe remote; feedback success in `textAccentMuted`, error `actionDangerText` | G8, mechanical: a `Card` headed by a `triangle-alert` glyph + "Developer tools" micro-label; outline buttons; Wipe remote an outline `tone="danger"`; feedback as `Notice` (`neutral` with `circle-check`, or `danger`). testIDs `settings-dev-*` and the success copy asserted at `settings-dev-wipe-local.yaml:92` are kept |

### `SyncStatusPanel`

| Today | Becomes |
| --- | --- |
| Card "Sync status" with 4 label/value rows (Last successful sync, Pending changes, Network, Error); **Offline in `textWarning`** (:123); error in `actionDangerText`; Refresh (secondary) | A `Card`: micro-label "Sync status", then `ListRow`s with the value as mono `meta`. Offline shows the `wifi-off` glyph + "Offline" in `ink` (G3); an error shows in `danger`. Refresh is an outline button. The copy ("Never", "None", "Sign-in required", "Online"/"Offline") and `settings-sync-status-*` testIDs are kept; Maestro asserts `-dirty-count` "0" |

### Logs (`dev-logs.tsx`, G8)

| Today | Becomes |
| --- | --- |
| `SegmentedChips` level filter (compact pills) + Clear; log cards with level colours (**warn = `textWarning`**, :35-40); context in `fontFamily: 'Courier'` | `ChipGroup mode="single"` keeping `dev-logs-filter-row` / `-<level>`; Clear as a text button; rows in a `Card`. Levels: error `danger`, warn `ink` + `triangle-alert`, info `ink-muted`, debug `ink-faint`. Context in Plex Mono 500 |

### Maestro harness (G8)

`ActivityIndicator` `inkMuted`; status `Text` in Source Sans `ink`; error in
`danger`; `paper` ground. The copy is load-bearing: flows wait for "Maestro
data reset complete." (`exercise-page.yaml:275`), so it is unchanged.

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| T04-D1 | More's decorative info-blue icon badges | Drop the badge and keep the glyph in `ink-muted` (G3) |
| T04-D2 | "Wipe local & re-bootstrap" has no confirmation while its siblings confirm | **Keep as is.** It is a dev-only tool, and behaviour stays |
| T04-D3 | Date format as a `SegmentedControl` (3 options) or `ChipGroup` | `SegmentedControl`: single choice, always 3 options, one row |

## UX contract

- **Open a More destination.** Trigger: a row. Success: the destination opens
  (external links open the browser). Edge: a failed external open shows the
  inline error.
- **Change the date format.** Trigger: a segment. Success: selected state
  moves and dates re-render. Edge: none.
- **Refresh sync.** Trigger: `Refresh`. Success: the rows update. Edge:
  offline shows `wifi-off` + "Offline"; an error shows in `danger`.
- **Developer tools** (dev builds): each action shows its feedback `Notice`,
  and the destructive ones confirm (`Alert.alert`, unchanged).

## Gallery

- `04-m26-more` (smoke); `06-settings-sections-top`, `07-settings-about-metadata`
  (auth-profile); `19-first-run-roundtrip-delta-synced` (sync panel, sync e2e).
- `02-dev-wipe-local-settings`, `03-dev-wipe-local-feedback` (ui-regression,
  information only).
- **New:** `settings-preferences` (scroll to the date format in
  `settings-dev-wipe-local.yaml`, asserting `settings-date-format-row`);
  `dev-logs` (the same flow taps `View logs` and asserts `dev-logs-filter-row`,
  information only). No flow can reach the signed-out sync card or the offline
  panel; they are jest-only and listed as such.

## Tests

- `more-screen`, `settings-onboarding`, `settings-profile-navigation`,
  `settings-dev-wipe`, `dev-affordances-gate`, `sync-status-panel`: behaviour and
  copy are unchanged. Add: offline renders the `wifi-off` glyph.

## Docs

- `screen-map.md` (Settings §6, More), `components-catalog.md` (`SyncStatusPanel`
  if listed), `design-targets/more-settings.md`.

## Gates

`./boga test fast` + `./boga test frontend`.

## Acceptance

1. No legacy identifier in the five files.
2. testIDs and asserted copy unchanged; gallery accepted.
3. Estimate: about 1,100 lines.
