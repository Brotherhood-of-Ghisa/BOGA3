# Accepted target — the Groups tab and the group page shell (repo-native brief)

Target record per `../ai-design-policy.md`, for DLM-T11 (the Groups tab's
stream, the record sheet, the group page shell and the state panels) of the
design-language migration. DLM-T12 (Leaderboards), DLM-T13 (group management)
and DLM-T14 (group exercises) extend it with their own sections. Chosen by the
user on 2026-09-24 (plan decision G1 (a)): a brief plus the gallery states the
user accepts. It supersedes `group-exercise-unlink.md` for appearance only; that
record's behaviour brief stays. **Accepted** by the user in the DLM-T11 gallery on
2026-09-25.

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

## Leaderboards (DLM-T12)

**Accepted** by the user in the DLM-T12 gallery on 2026-09-26, with the
session card's `1500 kg` (no separator) and `You` at Source Sans 600 (the
face ships no 700) confirmed.

### Brief

- **Podium cards** (the `Leaderboards` segment) are `Card` links: the exercise
  in Archivo 700, an `Archived` `Tag` beside it (centred on the name), and the view
  (`Certified · 1RM`) as a micro-label. Up to three rows follow behind
  `rule-soft` hairlines: rank, value and date in Plex Mono, the member in
  Source Sans, and my row reading `You` in Source Sans 600. The empty label and the
  `You: 5th` / `You: not ranked` line close the card.
- **The full board.** The exercise is the native header title only.
  `Archived · read-only` sits in `ink-muted` beside `History`, a text button.
  Then one row with two `SegmentedControl`s, `Weight` | `1RM` and
  `Certified` | `All` (solid `ink` when on). The rows are one `Card` of dense
  `ListRow`s behind `rule-soft` hairlines: rank and value in Plex Mono, the
  member in Source Sans with the 1RM's set under it in `ink-muted`, and the
  date with the certification mark on All (T11's check in `ink`, ring and
  `uncertified` in `ink-muted`). My row sits on `surface-subtle` and reads
  `You` (T12-D1). Empty, missing-data and lost-access are T11's `StatePanel`s;
  `See all sets` is their outline.
- **History** is the view's micro-label over one `Card` of rows: the date in
  small Plex Mono, then the sentence in Source Sans.
- **Numbers (G7, T12-D2).** The metric reads `1RM`, never `e1RM`. A value is
  a figure with no unit: a 1RM to one decimal (`64.1`) and a set in the app's
  weight figure (`55.0 × 5`, `51.25 × 5`). History sentences are prose and
  keep `kg`. No figure groups thousands, so the session card's volume reads
  `1500 kg`. The `e1rm` key, `metric=e1rm`, RPC fields and testIDs are
  unchanged.
- **No `accent`** on any leaderboard screen: none has a primary action.

### States

Device: iPhone simulator at 390pt width, light. All from `groups-two-user-stream`
(`ios-groups-e2e`).

| Screenshot | State |
| --- | --- |
| `groups-07b-1-podiums` | podiums: an empty Certified card with the uncertified count, and an archived card |
| `groups-07b-2-board-certified-empty` | the board on Certified, empty: `See all sets` |
| `groups-07b-3-board-all-e1rm` | All · 1RM: the value, the set under the member, `uncertified` |
| `groups-07b-4-board-all-weight` | All · Weight: the set as the value |
| `groups-07b-5-history-link` | History: a link lead change |
| `groups-07c-3-podium-certified` | a podium with a certified row 1 and `You: not ranked` |
| `groups-07c-4-board-certified-weight` | Certified · Weight after the certify |
| `groups-07c-5-history-certified` | History: `(certified by you)` |
| `groups-unlink-06-certified-empty` | Certified empty after an unlink |
| `groups-unlink-07-restored-certified` | my own row: `surface-subtle` and `You` |
| `groups-08b-board-former-member` | a former member's row, certified |

Jest only: the podium row with `You` in bold, the offline marker over loaded
rows, the offline and error panels, the exercise-missing state, and the
older-page footer.

## Group management (DLM-T13)

**Accepted** by the user in the DLM-T13 gallery on 2026-09-26.

### Brief

- **My groups.** `Join group` (outline) and `Create group` (the screen's one
  `accent`) share a row. The groups are one `Card` of dense `ListRow`s behind
  `rule-soft` hairlines: the name in Archivo 600, the description (two lines)
  in `ink-muted`, `N members · You're the owner` as a micro-label, and a
  `chevron-right`.
- **The group screen.** A header `Card`: the name in Archivo 700, the
  description in `ink-muted`, then a `Members` row with the count · role in
  `ink-muted` and a chevron (it opens Members). For owners and admins `Invite`
  is the screen's one `accent` beside an outline `Edit` (T13-D1). `Exercises`
  is a section micro-label, and its `Add exercise` is an outline.
- **Members.** The same header `Card` (name, count · role), the outcome
  `Notice`s, then one `Card` of dense rows: the name (+ `(you)`), the role as a
  `Tag`, and a chevron only on a row my role can act on (the control column
  stays empty otherwise, so the tags align). `Leave group` is an outline in
  `danger`; the owner reads the transfer note in `ink-muted` instead.
- **The action sheets** (members, and the group exercises' sheet, which shares
  `GroupActionSheet`) are `Sheet`s titled with the item, an `ink-muted`
  subtitle (the member's role), then one `ListRow` per action, `danger` when
  destructive. No Cancel: the backdrop dismisses them (G5, T13-D2). The native
  confirmations after `Remove` / `Transfer` are unchanged.
- **Invite.** A `Card`: the title in Archivo 700, the body in `ink-muted`, the
  code in Plex Mono 700 at `xxl`, letter-spaced (T13-D3), and the link in
  `ink-muted`. `Share invite` is the one `accent`; `Regenerate code` an outline
  in `danger`. "New code ready…" is a neutral `Notice` with the `success`
  glyph (G3).
- **Forms.** The username gate is a `Card` with its reason, a `FormField` and
  `Save username` (`accent`). Create / edit is two `FormField`s on the page,
  the description's `n/280` counter in Plex Mono under it, a `danger` `Notice`
  for the write's failure and the submit as the `accent`. Join is a Plex Mono
  `Invite code` field and an outline `Find group`, then a preview `Card` whose
  `Join group` is the `accent`.

### States

Device: iPhone simulator at 390pt width, light. All from `groups-two-user-stream`
(`ios-groups-e2e`).

| Screenshot | State |
| --- | --- |
| `groups-01-username-prompt` | the username gate before create |
| `groups-02-group-created` | the group screen as owner: header card, `Invite` + `Edit`, Exercises empty with an outline `Add exercise` |
| `groups-03-invite-code` | the invite: the code in Plex Mono, `Share invite`, `Regenerate code` |
| `groups-mine-list` | My groups: the action row over one card of rows |
| `groups-members-list` | Members as owner: header card, two rows with role `Tag`s, the transfer note |
| `groups-member-actions-sheet` | the member action sheet: `Make admin`, `Transfer ownership` and `Remove from group` in `danger`, no Cancel |
| `groups-members-removed` | Members after the removal: the neutral notice with the `success` glyph, one row |

Jest only (no flow reaches them): Join (the counterparty joins by script), the
empty create form, Edit, a regenerated code's notice, and the offline and
error states of each screen. `groups-08` (the stream) and `groups-09` (a
board) end the same flow but show no T13 screen.

## Group exercises and linking (DLM-T14)

**Accepted** by the user in the DLM-T14 gallery on 2026-09-26, with `Sheet`
titles wrapping to two lines (the pick sheet's `<exercise> · <group>`). This
section is the appearance target of `group-exercise-unlink.md`, whose behaviour
brief stays (T14-D4).

### Brief

- **Exercises section.** `Exercises` is a micro-label with `Add exercise` as
  an outline beside it (owner/admin): `Invite` is the group screen's one
  `accent` (T13-D1). The rows are one `Card` of dense `ListRow`s behind
  `rule-soft` hairlines: the name in Archivo 600, the weight entry and my link
  status (`Linked: …` / `Not linked`) in `ink-muted`, an `Archived` `Tag`
  centred on the text and a chevron when the row opens the exercise actions.
  `Unlink…` is a `danger` text button and `Link your exercise` an outline, both
  under the row. Outcomes are `Notice`s (neutral with the `success` glyph, or
  `danger`, G3); a failed links read is a `danger` `Notice` with an outline
  `Retry`. The row accessibility labels are unchanged.
- **Add exercise.** `From catalogue` | `Custom` is a `SegmentedControl`. The
  catalogue is a micro-label, a `SearchField` and one `Card` of radio rows (the
  weight entry on the right in `ink-muted`): the pick is `radio-on` in `ink`,
  with no ground change. The form is a `Card`: the copy note in `ink-muted`,
  T07's fields, a `danger` `Notice` on failure and the submit, the screen's one
  `accent`. Rename uses the same form.
- **The pick sheet** (also opened by the session picker) is a `Sheet` titled
  `<exercise> · <group>`, with no Cancel (G5): radio `ListRow`s (`radio-on` /
  `radio-off` in `ink`, no ground change), the other exercises under a
  `SearchField` with unavailable ones in `ink-faint` beside their reason, the
  notes in `ink-muted`, a `danger` `Notice` and the confirm, the sheet's one
  `accent` (T14-D3).
- **The unlink chooser** is a `Sheet` (`Your linked exercises`, then
  `<exercise> · <group>` in `ink-muted`) with no Cancel: one row per personal
  exercise, its name wrapping, and a `danger` text `Unlink`. The native
  confirmation opens only once the sheet has gone (`Sheet.onDismissed`,
  T14-D2); its `Cancel` / `Unlink` are OS chrome.
- **The Link screen.** The outcome is a `Notice` (neutral with the `success`
  glyph, or `danger`) in place of bare coloured text. `Linked`, `Suggested`
  and `All group exercises` are micro-labels over `Card`s of dense rows (a
  group's name in Archivo 700 above its card): `Unlink` a `danger` text button,
  `Link` an outline. A `SearchField` filters; empty, offline and error states
  are T11's `StatePanel`s and notices. No `accent`: the screen has no primary.

### States

Device: iPhone simulator at 390pt width, light. All from `ios-groups-e2e`.

| Screenshot (flow) | State |
| --- | --- |
| `groups-add-exercise-catalogue` (`groups-two-user-stream`) | From catalogue: a search, the picked radio row and the prefilled form |
| `groups-add-exercise-custom` (`groups-two-user-stream`) | Custom: the empty form |
| `groups-04b-1-exercises-added` (`groups-two-user-stream`) | the section with two exercises, `Link your exercise` under each |
| `groups-04b-2-pick-sheet-link-only` (`groups-two-user-stream`) | the pick sheet, link-only: the suggestion checked, `Link` |
| `groups-04b-3-exercise-linked-renamed-archived` (`groups-two-user-stream`) | the archive notice, a renamed row, an archived row with its `Tag` |
| `groups-unlink-01-linked-row` (`groups-two-user-stream`) | a row linked twice: `Unlink…` |
| `groups-unlink-02-chooser` (`groups-two-user-stream`) | the chooser sheet |
| `groups-unlink-03-confirmation` (`groups-two-user-stream`) | the native confirmation after the chooser has gone |
| `groups-unlink-04-success` (`groups-two-user-stream`) | the unlink notice, the second link kept |
| `groups-unlink-05-preserved-record` (`groups-two-user-stream`) | the record card, still certified |
| `groups-link-01-link-screen` (`groups-link-exercise`) | the Link screen: search, `Suggested`, `All group exercises` |
| `groups-link-02-linked` (`groups-link-exercise`) | after `Link`: the notice and the `Linked` card |
| `groups-link-06-exercise-page-link-screen` (`groups-link-exercise`) | the Link screen from the exercise page's ⋮ |

Jest only: the empty section, the failed links read with `Retry`, a failed
link in the pick sheet, unavailable choices, the Link screen's deleted,
offline and error states, and the Android `onDismissed` path.
