# M29 — Today landing page

- Status: `planned`
- Created: 2026-10-02, planning baseline `1754f6e2` on `origin/main`

## Objective

Today becomes a two-card landing page: **Progress** (this week, this month on
pace against last month, the latest session) and **Group activity** (this
week's top three by working sets and PRs, then the latest activity), each
linking to its full screen. The accepted design target is
`docs/specs/ui/design-targets/today-landing.md` (Claude Design canvas,
accepted 2026-10-02).

## Scope

- In: the Today route and its components; a local progress-summary data layer;
  a group weekly-summary RPC and its client; the specs, Jest and Maestro
  coverage this changes.
- Out: Train (unchanged); the Progress and Groups tabs themselves; the
  exercise-linking suggestion (dropped from Today on review); an in-progress
  workout card on Today (Train owns it); top-weight PRs (1RM only, as today).

## Agreed design direction

### D1. The target governs layout; the brief governs meaning

The canvas is the look; `today-landing.md`'s brief defines what each figure
counts. Canvas figures are invented.

### D2. Working sets, not volume

Every count on Today is working sets (`W/sets`, `ux-rules.md` §5.11), on both
cards. Volume does not appear.

### D3. Calendar weeks and months, local time

"This week" is Monday 00:00 to Sunday 24:00 in the device's local time zone;
"this month" is the local calendar month. The Progress tab's rolling windows
are not reused for this. Last week is the whole previous calendar week; the
month comparison is the previous month **up to the same day of month** (the
last day when the previous month is shorter).

### D4. A PR is the existing personal-record rule

A PR is a set whose estimated 1RM beats the lifter's best from all earlier
completed sessions on that exercise definition — the rule
`deriveSessionPersonalRecords` already applies (at most one per exercise per
session, none without earlier history). Today counts them per window. Group
records (linked group exercises) are a different thing and are not Today's
`PRs`.

### D5. Absolute differences, no percentages

Counts compare as signed absolute numbers (`ux-rules.md` §13.2). The week row
shows last week's totals as bars, not deltas.

### D6. Today has no `accent`

No primary action on Today. `record` marks PRs; the `viz` ramp draws the bars
and the chart fill.

### D7. The group card needs one server read

Per-member weekly working sets and PRs, who is training now and the latest
completed session come from one new group RPC, not from paging the stream
(the stream is paged and carries no working-set or PR counts).

### D8. Build order

Data before UI, Progress before Group, and the two UI tasks in sequence
because both rewrite `app/(tabs)/today.tsx`. T01 and T03 can run in parallel.

## Task breakdown

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| `M29-T01-Progress_summary_data` | Local week / month / PR / latest-session data for Today | none | planned |
| `M29-T02-Today_progress_card` | Rebuild Today with the Progress card; keep the current group snapshot | T01 | planned |
| `M29-T03-Group_week_summary_RPC` | Server RPC + client for the group card's data | none | planned |
| `M29-T04-Today_group_card_and_closeout` | The Group activity card, gallery acceptance, milestone closeout | T02, T03 | planned |

## Risks / dependencies

- **PR counting is O(history).** Counting PRs in a window replays every earlier
  completed session. T01 must measure it on a realistic history and memoise or
  cache if it shows.
- **Shared-to-group tags on the latest session** are not known locally (the
  share trigger is server-side). T02 decides whether to take them from the
  group stream or drop them.
- **Stale active sessions.** An abandoned draft stays `active` forever on the
  server; "training now" needs a staleness rule (T03).
- **Maestro.** `session-view.yaml` asserts Today's recents section and
  captures `today-recents`; T02 must move or replace that claim.
