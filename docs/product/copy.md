# Copy

### copy.no-subtitles · principle · accepted

A title stands alone: no line under a screen, sheet, card or section title
that describes it.

- **Test:** delete the line. If the user loses only words about the thing, it
  was a subtitle: remove it. If they lose a value (a date, a duration, a
  count, `3 sets · 1RM 102.5`), it is data and stays.
- **Bad:** a line like "Your training at a glance" under `Today`.
- **Good:** `06-10-2026 · 52 min` under a session title.
- **Kept:** `<group> · group view` above a group session's title: it says
  whose view of the session this is, which the screen cannot show otherwise
  (decided 2026-10-08).

Why: descriptive subtitles repeat the screen.

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

Why: labels carry meaning.

### copy.blank-history · presentation · accepted

A figure with no training behind it — a rest period, or one outside the data —
is left visibly blank: no `Rest`, `?`, substitute dash or zero. Known zero
training stays numeric. Accessibility preserves the difference between rest,
unavailable and known zero.

Why: missing data must not resemble a measurement.
Code: `apps/mobile/components/heatmaps/calendar-tile.tsx`; `apps/mobile/components/heatmaps/WeeklyHeatmap.tsx`.

### copy.set-entry · presentation · accepted

Workout, session-plan and programme set entry follow the recorder's copy:
`Effort`, `Weight`, `Reps`. Weight entry uses the same label for total-load
and per-side exercises; its accessible name is `Set N weight`.

Why: the recorder is the standard for entering sets, and planning follows it.
Code: `apps/mobile/components/exercise-page/set-entry-fields.tsx`.

### copy.no-weight-unit · presentation · accepted

While kg is the only supported weight unit, visible and spoken labels omit
kg and kilograms, including compound volume units. Keep `per side`, `%BW` and
`%BW·reps`. Stored values, wire units and coaching/import payloads stay unchanged.

Why: the sole weight unit adds no information. Approved 2026-10-17.
Code: `apps/mobile/src/groups/competition-view-model.ts` and mobile label components.

### copy.calendar-dates · presentation · accepted

Every complete calendar date displayed, spoken or edited uses Date format,
including ranges and shared images. Formatting preserves the device-local day
and stored instant. Month/day calendar headings, relative and time-only labels
keep their roles.

Why: one setting; issue #777.
Code: `apps/mobile/src/utils/local-time.ts`.
