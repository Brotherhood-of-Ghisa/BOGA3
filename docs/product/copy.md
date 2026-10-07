# Copy

### copy.no-subtitles · principle · accepted

A title stands alone: no line under a screen, sheet, card or section title
that describes it.

- **Test:** delete the line. If the user loses only words about the thing, it
  was a subtitle: remove it. If they lose a value (a date, a duration, a
  count, `3 sets · 1RM 102.5`), it is data and stays.
- **Bad:** a line like "Your training at a glance" under `Today`.
- **Good:** `Mon 6 Oct · 52 min` under a session title.

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
  - The preview under a group's scoring-rules form (`Apply rules revision N:
    … The whole board will rebuild together. …` and the certification note):
    removed, with nothing in its place (decided 2026-10-07).

Why: an explanation on screen means the label or the layout failed; fixing
those helps every user, every time.
Pending: the Volume coverage notes still show (`sessionVolumeSummary` in `apps/mobile/src/exercise-calculations/analytics.ts`; `apps/mobile/components/stats/progress-tables.tsx`), and so does the group rules review (`describeRulesChange` in `apps/mobile/src/groups/comparison-form-model.ts`).
