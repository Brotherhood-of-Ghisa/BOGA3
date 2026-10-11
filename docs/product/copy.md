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

Why: the screen's content already says what the screen is; a describing line
costs space and is read once.

### copy.no-inline-explanation · principle · accepted

Screens show data and controls, not sentences about them: no footnotes,
formula notes, field hints, "how this works" lines, or a rule's provenance
(`Rules N · …`).

- **Test:** a sentence about a figure or control, not content, goes; if the
  meaning needs it, fix the label or the design.
- **Exceptions:** an error line with its action; an empty state's one line,
  never a tutorial; a destructive alert naming what goes (`its N sets`); the
  agent-consent page's grant.
- **An incomplete figure takes no note:** one that left sets out, for an
  uncalculable load or kg a group cannot see, shows plain as `Volume`.
- **Bad:** `Sets = primary + ½ secondary` under Sets by muscle.
- **Good:** the label carries it — the ramp reads `Weekly target` `0%`…`100%`.

Why: an explanation on screen means the label or the layout failed; fixing
those helps every user, every time.

### copy.blank-history · presentation · accepted

A figure with no training behind it — a rest period, or one outside the data —
is left visibly blank: no `Rest`, `?`, substitute dash or zero. Known zero
training stays numeric. Accessibility preserves the difference between rest,
unavailable and known zero.

Why: an absent training figure should not look like a measurement or an error marker.
Code: `apps/mobile/components/heatmaps/calendar-tile.tsx`; `apps/mobile/components/heatmaps/WeeklyHeatmap.tsx`.
