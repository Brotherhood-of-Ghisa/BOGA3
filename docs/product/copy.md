# Copy

### copy.no-subtitles · principle · accepted

A title stands alone: no line under a screen, sheet, card or section title
that describes it.

- **Test:** delete the line. If the user loses only words about the thing, it
  was a subtitle: remove it. If they lose a value (a date, a duration, a
  count, `3 sets · 1RM 102.5`), it is data and stays.
- **Bad:** a line like "Your training at a glance" under `Today`.
- **Good:** `Mon 6 Oct · 52 min` under a session title.
- **Kept:** `<group> · group view` above a group session's title: it says
  whose view of the session this is, which the screen cannot show otherwise
  (decided 2026-10-08).
- **Cases** (removed after the fact, decided 2026-10-07):
  - `Sign in to load your data and keep it in sync.` under Sign in,
    `Agents can read training data only. …` under Connected agents, and
    `Community, coaching tools, and library management stay close …` under
    More.
  - The sentence under each Settings and More row (`Review access and
    revoke existing connections.`, `Sign in and manage your account.`, …);
    the signed-in email under Account is data and stays.
  - History heatmaps omit the window/Metric captions and percentile label
    stack. Metric controls and chart figures remain; reference identities,
    values and the history window are accessible.

Why: the screen's content already says what the screen is; a describing line
costs space and is read once.

### copy.no-inline-explanation · principle · accepted

Screens show data and controls, not sentences about them: no footnotes,
formula notes, hints under fields, or "how this works" lines.

- **Test:** if a sentence is about a figure or a control rather than being
  content, remove it. If the meaning is unclear without it, fix the label or
  the design instead.
- **Exceptions:**
  1. Errors: one line saying what failed, with the action (Retry).
  2. Empty states: one line saying what will appear here; no tutorial.
  3. Destructive confirmations: the system alert states what will be lost
     (`its N sets`).
  4. Consent and permission text: the agent-consent page states the access
     granted.
- **Cases** (removed after the fact):
  - `Sets = primary + ½ secondary` under Sets by muscle (#501).
  - A bare `So far` label above the summary cards (#504).
  - `Current week is in progress.` and `12-week average: …` under the weekly
    history bars (#535).
  - `Display chooses labels for logging. Working set controls…` above the
    effort table and `These choices apply to personal progress on this
    device. Groups keep their shared rules.` under it (#585).
  - `Colour: share of weekly muscle target` / `Colour: average share of
    muscle targets` + `. Full colour at 100%.` under the history heatmaps;
    the ramp reads `Weekly target` `0%`…`100%` instead (#585).
  - `Drag around the ring to choose a colour.` and `The rest of BoGa changes
    the next time you open it.` / `Saved. It applies the next time you open
    BoGa.` on Custom colour; the button reads `Saved · next launch` (#585).
  - `Pick any colour` under Custom colour and `… applies the next time you
    open BoGa. Close BoGa fully, then open it again.` under the Appearance
    presets; the pending row reads `Next launch` (#585).
  - `Volume incomplete. Known subtotal from X of Y included sets.` and
    `Volume unavailable. Some included sets have missing or invalid load
    information.` beside a Volume figure: a set whose load cannot be
    calculated is left out and the Volume of the rest is shown, with no note
    (decided 2026-10-07).
  - A group session's Volume leaves out the sets whose kg the group cannot
    see (normalized exercises) and is shown as `Volume`, with no note
    (decided 2026-10-08).
  - The preview under a group's scoring-rules form (`Apply rules revision N:
    … The whole board will rebuild together. …` and the certification note):
    removed, with nothing in its place (decided 2026-10-07).
  - Field hints on the exercise forms: under Weight entry and Bodyweight
    contribution (%), `Members can switch ranking views. …` under Default
    ranking, `Pick a standard exercise to copy.` and `Copies the standard
    exercise "…". …` on Add group exercise (decided 2026-10-07).
  - `Anyone with this code can join. …` on the group invite and `Group
    members see you by your username. …` on Choose a username (decided
    2026-10-07).
  - `Coaches get read-only training access …` under AI coaching and
    `Configure how dates and other details are displayed …` in Settings'
    Preferences (decided 2026-10-07).
  - Every rules line on group screens (decided 2026-10-08): `Rules N · …%
    contribution · Bodyweight scoring … · … load` on the board, its row
    sheet, the exercise rows and actions and the link notes (with `Your
    personal exercise settings stay unchanged.`); `· Rules N` on podium
    cards and stream cards; the history's rules line, revision chips and
    `History keeps each value's original unit. …`; `Scores use the group's
    … rules …`, `Certification attests …` and `Observed under rules N; …`
    on the record sheets; `View rules history`. `As logged: …` is gone: the
    set has its own line.

Why: an explanation on screen means the label or the layout failed; fixing
those helps every user, every time.

### copy.blank-history · presentation · accepted

Daily and Weekly history leave rest and unavailable figures visibly blank,
including Daily's Week column: no `Rest`, `?`, substitute dash or zero. Known
zero training stays numeric. Accessibility preserves the difference between
rest, unavailable and known zero values.

Why: an absent training figure should not look like a measurement or an error marker.
Code: `apps/mobile/components/heatmaps/calendar-tile.tsx`; `apps/mobile/components/heatmaps/WeeklyHeatmap.tsx`.
