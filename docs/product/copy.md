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

Why: an explanation on screen means the label or the layout failed; fixing
those helps every user, every time.
