---
task_id: DLM-T11-Groups_stream_shell_and_state_panels
milestone_id: "none (plan: docs/plans/design-language-migration.md)"
status: planned
ui_impact: "yes"
areas: "frontend"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend"
docs_touched: "docs/specs/ui/{screen-map,ux-rules,components-catalog}.md, docs/specs/08-ux-delivery-standard.md (patterns 6, 7, 9, 11), docs/specs/tech/groups-contract.md (copy it quotes), docs/specs/ui/design-targets/groups.md (new)"
---

# DLM-T11 Groups tab: stream, record sheet, the group shell and state panels

- Status: `planned`, **approved 2026-09-24** (decisions as recommended).
- Depends on: T01, T02. T12, T13 and T14 depend on this card.
- Design target (G1): brief + gallery → `design-targets/groups.md`.
- Files (about 1,500 lines): `app/(tabs)/groups.tsx`, and in
  `components/groups/`: `group-filter-chips`, `group-stream-list`,
  `stream-session-card`, `stream-record-card`, `stream-membership-item`,
  `stream-sentence-item`, `certification-status`, `record-set-sheet`,
  `offline-banner`, `write-notice`, `group-state-view`, `group-pages-footer`,
  `sign-in-required`, and `screen-styles.ts` (the `groupScreenStyles` half;
  `groupFormStyles` is T13's).
- **Reach:** Today renders the stream cards, offline banner, inline error,
  missing-data and `GroupStateView` (`today.tsx:238-463`), so Today's group
  activity changes here. Every group route uses `groupScreenStyles` and the
  state panels, so all group screens move to `paper` and the new panels in this
  card; T12–T14 restyle their contents.

## Today → becomes

| Today (file:line) | Becomes |
| --- | --- |
| `groupScreenStyles.screen`: `surfacePage`, padding `xl`, gap `lg` | `Screen` / `ScreenScroll` (`paper`, the DL gutter), with `refreshControl` for pull-to-refresh (`08` pattern 8, unchanged) |
| Groups header: title "Groups" + secondary "My groups" | Title as the other tabs; "My groups" a text `ActionButton` |
| `GroupFilterChips`: compact wrapping `SegmentedChips` pills, no "All" | `ChipGroup mode="single"` (wrap). `groups-stream-filter-<id>`, `-row` absent-by-design assertions, and `selected` are kept |
| Stream / Leaderboards: `SegmentedChips` joined (`groups-segment`) | `SegmentedControl` (`groups-segment-stream` / `-leaderboards` kept) |
| `GroupStreamSessionCard`: pressable `UiSurface`; member; **status pill "Training now" in success green** / "Completed · …" neutral (:81-97); date · gym; metrics; "N records"; group names | A link `Card`: member in Archivo 700; the status line **"Training now" with the `set-current` glyph**, "Completed · 45m" in `ink-muted` (G3; text kept, Maestro asserts it); metrics in Plex Mono; "N records" in `record` (it names records); group names `ink-muted` |
| `GroupStreamRecordCard`: `panelMuted` when **voided**, `card` otherwise; title "dave — group record" / "— PR", exercise and value, badges (`borderMuted` pills), provisional, `GroupCertificationStatus`, group; `Certify` (secondary) + `GroupWriteNotice` | A `Card` with a **`record` band** (`recordWash` / `recordRule`, as `PersonalRecordCard` and the session view), carrying the title. The value in Plex Mono 700 `record`. Badges → `Tag`. **Voided: no band, faded to `ink-faint`**, with the status line first (T11-D2). `Certify` outline. testIDs kept (`-open`, `-title`, `-value`, `-provisional`, `-status`, `-group`, `-certify`, `-notice`) |
| `GroupCertificationStatus`: a check in **`textSuccess` green**, a ring `textSecondary`, none when voided | Check and ring in `ink` / `ink-muted`; the `-mark-certified` / `-mark-uncertified` testIDs are kept |
| Membership and sentence items: a light row with a 3px `borderMuted` left rule | The same light row, with a `rule` hairline left edge and `ink-muted` Source Sans. Not a card (`08` pattern 6) |
| `RecordSetSheet`: RN `Modal` (fade); scrim `group-record-sheet-overlay`, a11y "Close set details"; title, value, logged, date, logged-as, provisional, status, lifter note, notice; actions: **Certify (primary)**, Withdraw / Cancel certification (danger), "View full session" (secondary), **"Close" (`group-record-sheet-close`)** | A `Sheet` (G5) titled with the exercise: stacked `Stat`s (value in `record` mono, logged, date, logged-as), status, note, `Notice`; `Certify` the sheet's `accent`; Withdraw / Cancel as `ListRow tone="danger"` (the `Alert.alert` confirms and their labels are unchanged); "View full session" a `ListRow` link. **No Close**: `dismissLabel` "Close set details". `group-record-sheet` (panel) and the action testIDs are kept; `-overlay` becomes `-backdrop` |
| `GroupOfflineBanner`: **warning surface** (:17-28) | `Notice` + `wifi-off`, `live`, "Offline · last updated HH:MM" kept (`08` pattern 7) |
| `GroupWriteNotice`: error danger-subtle (`alert`); **success green** | `Notice tone="danger"` / `Notice` + `circle-check` (copy kept: "Certified. Certified boards update in a few seconds.") |
| `GroupStateView` (card, title, body, secondary action), `GroupLostAccessState`, `GroupLoadingState`, `GroupsEmptyState` + `GroupsEmptyActions` (**Create group primary** + Join secondary), `GroupMissingDataState`, `GroupsSignInRequired`; **`GroupInlineError` with a danger Retry** and a spacing token misused as a radius (:147-160) | All become thin wrappers over `StatePanel` (keeping their names, props and testIDs, so T12–T14 and Today need no call-site changes). `GroupInlineError` → `Notice tone="danger"` + an **outline** `Retry` (G6). `Create group` stays the empty state's one primary |
| `GroupPagesFooter`: spinner or error + Retry | `StatePanel` inline (testIDs kept) |

## Decisions

| # | Question | Recommendation |
| --- | --- | --- |
| T11-D1 | "Training now": green pill today | The `set-current` glyph + "Training now" in `ink`. The ring already means "current" in the design language and on the group session view |
| **T11-D2** | Record cards: today a plain card (or the muted panel when voided). (a) The `record` band, as on the session view and the completion screen; (b) a plain card with a `record`-coloured value | **(a).** A group record or PR is the same idea as the app's records. Voided cards lose the band and fade. This removes `panelMuted`'s double meaning (voided vs my board row, T12) |
| T11-D3 | `RecordSetSheet` loses its Close button (G5) | Yes. Maestro taps `group-record-sheet-close` at :491, :645, :761 and :901. **Replace them with a backdrop tap by point** and keep the `assertNotVisible group-record-sheet` after each. Jest `groups-record-set-sheet.test.tsx:507` presses `group-record-sheet-backdrop` |
| T11-D4 | Stream copy quotes `e1RM` and `kg` (`src/groups/stream-view-model.ts:235,290,345,361`, `record-set-view-model.ts:249`): "Group record · e1RM", "140 kg × 1 · e1RM 142.5 kg" | Per G7 (a), **`1RM`** everywhere, and no `kg` in value slots ("140.0 × 1 · 1RM 142.5"); prose sentences keep units. The Maestro label regexes, `groups-stream-view-model.test.ts`, `groups-record-set-view-model.test.ts` and the `groups-contract` copy update with it. **View keys, params and RPC values are unchanged**: display copy only |
| T11-D5 | `GroupStateView` and friends: rewrite them, or wrap `StatePanel`? | **Wrap.** No call-site churn across 16 routes and Today |

## UX contract

- **Browse the stream.** Trigger: Groups tab. Steps: chip → stream. Success:
  session cards ("Training now" with the ring, or "Completed · 45m"), record
  cards under their session with the brass band, and light membership rows.
  Edge: offline shows the notice above cached items; no cache shows the offline
  panel; lost access shows its panel.
- **Certify.** Trigger: `Certify` on a card or in the sheet. Success: the
  notice "Certified. Certified boards update in a few seconds." Edge: offline
  is refused before any request (pattern 9); a conflict says nothing changed.
- **Record sheet.** Trigger: a record card. Success: the `Sheet` with the
  values and the actions my role allows; the backdrop dismisses. Edge: removals
  confirm natively.
- **Today's group activity:** the same cards, read-only (no `Certify`), opening
  the Groups screen.

## Gallery

`groups-two-user-stream` (`ios-groups-e2e`):

- `groups-04-counterparty-joined`, `05-training-now-card`,
  `06-completed-edited-card`, `07b-6-stream-link-item`;
- `07b-7-row-detail`, `07c-6-row-detail-certified`, `08b-2-row-detail-former`
  (the record sheet);
- `07c-0-today-record` (Today), `07c-1-record-card`, `07c-2-certified-card`;
- `08-counterparty-removed`.

**New:** `groups-offline-banner`, but only if the flow can toggle the network,
which it cannot today. Otherwise it is jest-only, listed.

## Tests

- `groups-screens.test.tsx`: :287 "Training now", :308-353 `selected`,
  :257/:307 absent `-row` / `-all`. Kept.
- `groups-record-set-sheet.test.tsx`:
  - :507 → backdrop;
  - :185, :243, :358-425 copy kept;
  - :484 mark testIDs kept.
- `today-screen.test.tsx:291`: offline banner testID kept.
- Add: a voided record card has no band; a standing one has `-record` band
  text.

## Docs

- `08-ux-delivery-standard.md`:
  - pattern 6: stream card, status in text + glyph;
  - pattern 7: offline marker is a `Notice`, not a warning surface;
  - pattern 9: `write-notice` wording;
  - pattern 11: the record sheet is a `Sheet` with no Close.
- `ux-rules.md` §14.2, §14.4 (the "warning-surface banner", "`Certify`" and
  icons text), §14.14.
- `tech/groups-contract.md`: where it quotes "e1RM" display copy (T11-D4).
- `components-catalog.md` specialized 11 (the listed components).
- `design-targets/groups.md`: new.

## Gates

`./boga test fast` + `./boga test frontend` (`ios-groups-e2e` is the key lane).
Watch for the edge-runtime trap: if `link-board` fails, check
`supabase_edge_runtime_*`, then `./boga db down` and re-run.

## Acceptance

1. No legacy identifier in the listed files.
2. No Close in `RecordSetSheet`; the flows are green with backdrop taps.
3. Gallery accepted (Groups and Today).
4. Estimate: about 1,500 lines.
