# Copy

### copy.no-subtitles · principle · accepted

Screen, sheet, card and section titles stand alone: no descriptive line beneath.

- **Test:** remove lines describing the thing; retain data: dates, durations,
  counts, `3 sets · 1RM 102.5`.
- **Bad:** "Your training at a glance" under `Today`.
- **Good:** `06-10-2026 · 52 min` under a session title.
- **Kept:** `<group> · group view` identifies otherwise-unknown ownership
  above group session titles (decided 2026-10-08).

### copy.no-inline-explanation · principle · accepted

Screens show data and controls: no explanatory footnotes, formulas, hints,
tutorials or rule provenance (`Rules N · …`).

- **Test:** replace explanations with clearer labels/design.
- **Exceptions:** an error line with its action; an empty state's one line,
  never a tutorial; a destructive alert naming what goes (`its N sets`); the
  agent-consent page's grant; the explicitly opened RM curve explainer.
- **Incomplete figures:** plain `Volume`, even when excluding uncalculable
  loads or kg a group cannot see.
- **Bad:** `Sets = primary + ½ secondary` under Sets by muscle.
- **Good:** `Weekly target` ramp: `0%`…`100%`.

### copy.blank-history · presentation · accepted

Figures without training (rest or outside the data) stay blank: no `Rest`,
`?`, dash or zero. Known zero stays numeric. Accessibility distinguishes rest,
unavailable and known zero.

Why: distinguish missing data from measurements.
Code: `apps/mobile/components/heatmaps/calendar-tile.tsx`; `apps/mobile/components/heatmaps/WeeklyHeatmap.tsx`.

### copy.no-weight-unit · presentation · accepted

While kg is the sole weight unit, visible/spoken labels omit kg/kilograms,
including compound volume units. Retain `per side`, `%BW`, `%BW·reps`. Stored
values, wire units and coaching/import payloads stay unchanged.
Shared group-session cards may use `(% BW)` once in the exercise heading
instead of visible per-set units; spoken units remain complete.

Code: `apps/mobile/src/groups/competition-view-model.ts` and mobile label components.

### copy.calendar-dates · presentation · accepted

Complete dates displayed, spoken or edited use Date format, including ranges
and shared images, preserving device-local days and stored instants. Month/day
headings, relative and time-only labels keep their roles.

Calendar-week headings may use a named month and shared year/day range in the
selected order; accessibility retains complete numeric dates.

- **Exception — Today** (decided 2026-10-26): every Today date is `26 Oct 26`,
  whatever the setting. A range takes one dash and the year once, at its end:
  `12 – 18 Oct 26`, `26 Oct – 1 Nov 26`; across years both ends carry it.

Code: `apps/mobile/src/utils/local-time.ts` (Today: `formatCompactDate`, `formatCompactDateRange`).
