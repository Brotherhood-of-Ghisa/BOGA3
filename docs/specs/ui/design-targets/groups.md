# Accepted target — the Groups tab and the group page shell (repo-native brief)

Target record per `../ai-design-policy.md`, for DLM-T11 (the Groups tab's
stream, the record sheet, the group page shell and the state panels) of the
design-language migration. DLM-T12 (Leaderboards), DLM-T13 (group management)
and DLM-T14 (group exercises) extend it with their own sections. Chosen by the
user on 2026-09-24 (plan decision G1 (a)): a brief plus the gallery states the
user accepts. It supersedes `group-exercise-unlink.md` for appearance only; that
record's behaviour brief stays. **Pending acceptance** in the DLM-T11 gallery.

## Target

- Vocabulary: `../design-language.md` and the app frame (`app-frame.md`).
- This brief, plus the gallery states below. No artboards.

## Brief

- **The shell.** Every group route sits on `paper` with the `lg` gutter and `md`
  between blocks (`Screen` / `ScreenScroll`, or `groupScreenStyles` for a
  `FlatList`). The Groups tab has the `Groups` `PageHeader` with `My groups` as
  a caps text button beside it, the group chips as a single `ChipGroup` (solid
  `ink` when on, never `accent`) and `Stream` | `Leaderboards` as a
  `SegmentedControl`.
- **Session cards** are `Card` links: the member in Archivo 700; the status in
  words, never a colour (G3): `Training now` beside the `set-current` ring, or
  `Completed · 45m` in `ink-muted`; start · gym in `ink-muted`; the metrics in
  Plex Mono; `N records` in `record` with an up arrow. Membership, link and
  record-removed items are light `ink-muted` rows behind a `rule` hairline, not
  cards.
- **Record cards** sit indented under their session card. A standing record
  carries the `record` band (`record-wash` / `record-rule`) with its title
  (`dave — group record`), then the exercise and its figures in bold `record`
  Plex Mono (`140.0 × 1 · 1RM 142.5`: `1RM`, no unit in a figure, G7), the
  boards as `Tag`s and the certification line (a check in `ink`, a ring in
  `ink-muted`). `Certify` is an outline. A voided record loses the band, fades
  to `ink-faint` and puts its status first (T11-D2).
- **The record sheet** is a `Sheet` titled with the lifter and the exercise,
  with no Close: the backdrop dismisses it (G5). The set and the 1RM are
  `record` `Stat`s, then the logged, date · gym, logged-as and status lines.
  `Certify` is the sheet's one `accent` (G6); `Remove my certification` /
  `Cancel certification` are `danger` rows that confirm natively, and
  `View full session` is a row with a chevron.
- **Notices and states.** The offline marker is a neutral `Notice` with the
  `offline` glyph (no warning hue); a write's outcome is a `danger` `Notice` or
  a neutral one with the `success` glyph; an inline failure is a `danger`
  `Notice` with an outline `Retry`. Empty, loading, error, lost-access and
  sign-in states are `StatePanel`s (`GroupStateView` and friends wrap it), and
  the no-groups state's `Create group` is the screen's one primary.
- **Today's group activity** is the same cards, read-only (no `Certify`).

## States

Device: iPhone simulator at 390pt width, light. All from `groups-two-user-stream`
(`ios-groups-e2e`).

| Screenshot | State |
| --- | --- |
| `groups-04-counterparty-joined` | the stream after the counterparty joins: chips, segment, a membership row |
| `groups-05-training-now-card` | a session card `Training now` |
| `groups-06-completed-edited-card` | the same card `Completed · 45m`, its metrics updated |
| `groups-07b-6-stream-link-item` | a link item in the stream |
| `groups-07b-7-row-detail` | the record sheet from a board row: converted value, `Certify` |
| `groups-07c-0-today-record` | Today's group activity with the record card, read-only |
| `groups-07c-1-record-card` | a record card under its session card (`1 record`) |
| `groups-07c-2-certified-card` | the card after `Certify`: the notice and `Certified by you` |
| `groups-07c-6-row-detail-certified` | the record sheet, certified: `Remove my certification` |
| `groups-08-counterparty-removed` | the stream after a member is removed |
| `groups-08b-2-row-detail-former` | the record sheet for a former member: no `Certify` |

Jest only (no flow reaches them, since the flow cannot toggle the network or
force a failure): the offline marker, the inline error, the missing-data and
lost-access panels, the empty state, the older-page footer, a voided record
card, and a failed certification.

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
