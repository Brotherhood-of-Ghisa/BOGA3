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

- In: a local, derived per-exercise-per-session facts table with PR flags
  (the base for this and later PR-history views); the Today route and its
  components; a local progress-summary data layer; a group weekly-summary RPC
  and its client; moving the existing PR readers onto the facts table, one PR
  per reader (T06–T08, added by T01's session); the specs, Jest and Maestro
  coverage this changes.
- Out:
  - Train (unchanged); the Progress and Groups tabs themselves.
  - The exercise-linking suggestion (dropped from Today on review).
  - An in-progress workout card on Today (Train owns it).
  - Top-weight and volume PRs on Today (1RM only, as today). The facts table
    stores them for later views.
  - PR-history screens and a per-muscle PR timeline (later; the facts table
    supports them).

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

### D4. `PRs` means a personal record on Progress and a group record on Group

- **Progress card:** a PR is a set whose estimated 1RM beats the lifter's best
  from all earlier completed sessions on that exercise definition. This is the
  rule `deriveSessionPersonalRecords` already applies: at most one per exercise
  per session, none without earlier history. Today counts them per window, read
  from the facts table (D9).
- **Group activity card:** `PRs` are **group records only**. These are the
  evaluator's `record` events on the group's linked exercises
  (`groups-contract.md` §2.10–§2.11), already server-side. Personal PRs never
  appear on the group card. Settled in T04 (`groups-contract.md` §4.7): a
  non-voided record where the member took #1 on a board, one per event, from
  completed sessions only; the board's working sets also count completed
  sessions only.
- The two counts follow different rules and are not expected to agree. For
  example, a member's first lift on a group exercise is a group record but not
  a personal PR.

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

- Facts before the progress read, data before UI, Progress before Group.
- The two UI tasks run in sequence, because both rewrite `app/(tabs)/today.tsx`.
- The group RPC (T04) needs nothing from T01–T03 and can run in parallel.
- The reader rewires (T06–T08) need only T01 and can run beside T02–T05. T06
  and T07 both touch `src/session-insights/`, so run them one after the other.
- T08 also waits for `M30-T01` (warm-ups leave every record). T06 and T07 do
  not, but must not run at the same time as `M30-T01`, which edits the same
  PR paths.

### D9. PRs are derived once and stored per exercise per session

Answering "is this a PR?" today replays every earlier completed session and
every set, for every exercise (O(all sets ever logged)). M29 adds a local-only
derived table instead, with one row per completed session × linked exercise
definition:

- **Bests:** best 1RM, top weight, volume, and working sets.
- **Flags:** a PR flag for each of the three metrics. At most one per exercise
  per session; the first session of an exercise carries none.
- **Index:** `(exercise_definition_id, completed_at)`.

Properties:

- **Not synced:** each device derives its own rows. Cleared on wipe.
- **Never served stale:** SQLite triggers on the raw and policy tables queue
  stale definitions; every read drains the queue first (read path only, no
  warm-up hooks yet). A one-row rules-version marker (not a per-row column)
  forces a full rebuild on a fresh install, after a wipe and after a rule
  change.
- **Proven against a full rebuild:** the full rebuild is the oracle in Jest,
  and the 1RM flags must equal `deriveSessionPersonalRecords`.

Volume is a per-exercise-per-session total, so the grain is the
exercise-in-session, not the set; the best sets are referenced by id. Changing
a calculation rule means one full rebuild on each device. Shipped by T01; the
durable rules are in spec 05, "Exercise session facts". Ties inside a session
now go to session order (block, then set), for the existing PR badge too.

D9's table stays device-only: the group card's PRs (D4) come from the
server's own group records, so nothing server-side needs personal PR flags.

## Task breakdown

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| `M29-T01-Exercise_session_facts` | Local derived per-exercise-per-session facts with 1RM / weight / volume PR flags | none | completed |
| `M29-T02-Progress_summary_data` | Local week / month / PR / latest-session data for Today | T01 | completed |
| `M29-T03-Today_progress_card` | Rebuild Today with the Progress card; keep the current group snapshot | T02 | completed |
| `M29-T04-Group_week_summary_RPC` | Server RPC + client for the group card's data | none | completed |
| `M29-T05-Today_group_card_and_closeout` | The Group activity card, gallery acceptance, milestone closeout | T03, T04 | planned |
| `M29-T06-Completion_PRs_on_facts` | Completed-session and completion-screen PRs read the facts table | T01 | completed |
| `M29-T07-Session_view_PRs_on_facts` | The session view's live PR bar reads earlier bests from the facts table | T01 | completed |
| `M29-T08-Exercise_records_on_facts` | Exercise page and history records read the facts table | T01, `M30-T01` | planned |

## Risks / dependencies

- **Facts drifting from raw rows.** Many paths write sets and sessions: the
  recorder, completed-edit, the session list, sync pull-apply, imports, and
  policy edits. A missed path serves wrong PRs. T01 covers every path through
  triggers (recommended) and proves incremental maintenance equals a full
  rebuild.
- **Rebuild cost.** A full rebuild runs once per device on first launch and on
  each rules bump. T01 measures it, and the incremental update, on a large
  fixture history; no estimates.
- **Shared-to-group tags on the latest session** are not known locally (the
  share trigger is server-side). T03 decides whether to take them from the
  group stream or drop them.
- **Stale active sessions.** An abandoned draft stays `active` forever on the
  server; "training now" needs a staleness rule (T04).
- **Maestro.** `session-view.yaml` asserts Today's recents section and
  captures `today-recents`; T03 must move or replace that claim.
