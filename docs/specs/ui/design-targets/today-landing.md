# Accepted target — the Today landing page (Claude Design canvas)

Target record per `../ai-design-policy.md`. Accepted by the user on
2026-10-02 from a Claude Design canvas drawn in the app's vocabulary. It
replaces the layout half of `today-train.md` for Today (the next-workout card,
the separate recent-sessions list and the group stream snapshot); Train is
unchanged. **Built**: both cards are integrated, and the user accepted the
runtime gallery of every state below on 2026-10-03.

## Target

- Canvas: <https://claude.ai/artifact/1VJorbuzeomDRKkF6sPhTz>, version
  `1790949581-bc76` (2026-10-02). Four artboards: `Today — two groups, latest
  completed`, `State · New user, no group`, `Group · one group, one training
  now`, `Group · several training now, you outside top 3`.
- Vocabulary: `../design-language.md` and the app frame (`app-frame.md`). The
  canvas uses the Warm preset's roles; a build names roles, never the hexes.
- The canvas data is invented (dated Thu 16 Oct). The figures illustrate the
  layout; this brief, not the canvas, defines what each figure counts.

## Brief

- **No page title.** Today opens on its first section; the tab strip already
  names the page, as on Progress.
- **Two sections**, each a `SectionHeader` with a caps text-button link:
  `Progress` → `View progress` (the Progress tab) and `Group activity` →
  `View groups` (the Groups tab). Each section is one `Card`.
- **Progress card, top: this week** (Mon–Sun, local). A `This week` micro-label
  with the date range in `ink-faint`, then three stacked figures: `Sessions`,
  `W/sets` (working sets, `ux-rules.md` §5.11) and `PRs` (the `record` figure
  with its up arrow). Under each figure a thin bar on the `viz` ramp shows this
  week as a share of **last week's total** (full, in the darker step, once it
  is passed) and a caption `of <n> last wk`. No signed deltas: a part week
  against a whole one says little.
- **Progress card, middle: the month.** `<Month> so far` with the month's
  working sets in Plex Mono 700, and on the right the signed absolute
  difference from the previous month at the same day (`+4`, `ahead of Sep's
  pace`; counts never take a percentage, `ux-rules.md` §13.2). Then a
  cumulative working-sets line by day of month: this month solid `ink` up to
  today with a `viz0` fill under it, the previous month dashed `ink-faint`
  across its whole length, a `ink-ghost` dotted projection from today to month
  end, a dot for today on each line, and `1` / today / last-day axis labels.
  Under it one `ink-muted` line: `On course for <projection> vs <prev>'s
  <total> · <n> sessions vs <n> · <n> PRs vs <n>`.
- **Progress card, bottom: latest session.** A `Latest session` micro-label
  with `All sessions` (caps text button → the Sessions list), then the most
  recent completed session as one link row: the session summary line (stamp ·
  duration @ gym), `<n> W/sets · <n> exercises`, the leading exercise names
  (one line, ellipsised), its PR count in `record` and a `Tag` per group it was
  shared to. Opens the completed session. No in-progress state: an active
  workout is reached from Train.
- **Group card, top: this week's board.** A `ChipGroup` switcher only when the
  user belongs to more than one group; with one group the board's micro-label
  names it (`<group> · this week`). The board is the top three members by
  working sets this week: rank, member (`You` in Source Sans 600 on `paper`),
  a `viz` bar (the leader one step darker), `W/S` and `PRs` columns. The
  card's `PRs` are **group records** (the member took #1 on a group board),
  not personal PRs, so they need not match the Progress card's. When the
  user is outside the top three, a `You · <rank>` line with their figures
  closes the board.
- **Group card, bottom: latest activity.** A `Latest activity` micro-label,
  then one link row: one member training now (the `set-current` ring and
  `Training now`, start · gym, `<n> W/sets · <n> exercises`; opens the group
  session); else the most recent completed session (`Completed · <duration>`,
  its group record as a `record` line; opens the group session). When several
  members are training now, the row is `<n> training now`, their names and
  gyms, and opens the Groups tab.
- **Emphasis.** No `accent` anywhere on Today: it has no primary action. The
  only colour beyond the neutrals and the `viz` ramp is `record` for PRs.
- **States.** A user with no sessions sees a `StatePanel` in the Progress card
  (`Your week starts here`, `Open Train` outline); a user in no group sees one
  in the group card (`Train with friends`, `Find a group` outline). Signed-out,
  auth-unavailable, offline, loading and error keep today's `StatePanel` /
  `Notice` recipes and copy where they still apply.

## Build decisions

Where the build departs from the canvas or settles what the brief left open:

- **No group tags on the latest session.** The canvas draws a `Tag` per group
  the session was shared to. Sharing is decided on the server (from membership
  history), so the device does not know it; the row shows none.
- **Exercise names ellipsise.** The row joins every exercise name on one line
  and truncates it, with no `+<n>` count.
- **Bars fill once reached.** A week bar is full, in the darker `viz` step,
  once this week matches last week's total (not only when it passes it). With
  nothing last week, any figure fills it; a zero is empty.
- **PR figures.** A PR figure is `record` with its up arrow only when it is
  above zero; `0` is plain `ink`.
- **The chart.** The longer of the two months spans the width. The chart is
  one image for VoiceOver, labelled with its summary sentence (not shown on
  screen); the visible summary line under it stays.
- **The group selection is the Groups screen's.** With several groups the
  card shows the group last viewed on either screen (else the first), and a
  chip pick moves both; `View groups` and the board open the Groups screen on
  that group.
- **The board and the several-training row are links** to the Groups screen
  on the group; one member training now and the latest completed session
  open that group session.
- **Member names get 72pt** on the board and ellipsise; the bars take the
  rest.
- **The latest completed row** stamps its start as the Progress card does
  (`10/16 06:10 · Iron Works`); a training-now start is the clock time today
  (`Started 07:40`), else the date and time.
- **The record line** leads with the first group record, 1RM before Weight:
  the figure (`Deadlift 1RM 213.3`) in `record` Plex Mono, then
  `· group record` in `ink-muted` body (`· <n> group records` with more).
- **No live or completed session** in the group: one muted line, `No sessions
  shared to this group yet.`
- **Offline** keeps the cached week under the offline `Notice`; the cached
  week carries its window, so last week's board never shows as this week's.
- **Signed out never reaches Today** in a configured build (root route access
  keeps a signed-out user on `/sign-in`); the card's sign-in panel stays for
  that state, and an unconfigured build shows the auth-unavailable panel.

## States

Device: iPhone 17 Pro simulator (402pt, the slot simulator), light. Captured
from live data on a local Supabase stack by one-off flows over the harness
(`bootstrap=complete`, `fixture=today-progress`, `teleport=today`); no
committed flow asserts Today beyond `today-screen` in `smoke-launch.yaml`
(lane `ios-smoke`): Jest owns Today (`today-screen.test.tsx`,
`today-group-card.test.tsx`, `groups-week-summary-view-model.test.ts`).

| Screenshot | State | Proves |
| --- | --- | --- |
| `today-group-05-whole-page-top` / `-bottom` | two groups, latest group activity completed | the whole page; the group record line |
| `today-group-02-no-group` | new user, no group | both empty panels |
| `today-group-03-one-group-training` | one group, one member training now | no switcher; the group-named board; the live row |
| `today-group-04-several-training` | several training now, the user outside the top three | the switcher; `You · <rank>`; the collapsed row |
| `today-group-01-auth-unavailable-bottom` | an unconfigured build | the no-account group panel (signed out never reaches Today) |

Offline, the error states and Retry are Jest-only (`today-group-card.test.tsx`).
No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
