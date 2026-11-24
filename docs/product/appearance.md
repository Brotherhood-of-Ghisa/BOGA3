# Appearance

### appearance.november · presentation · accepted

Every local November, launcher icons and every shared 3D human figure wear
classic handlebar moustaches; ordinary appearance returns outside November,
annually. The device's current calendar governs this decoration, independently
of viewed training dates. Theme selection, muscle colouring, metrics, selection
and accessibility stay unchanged. There is no setting or campaign UI.

Why: a small annual Easter egg shared by the app identity and its human model.
Launcher changes are best effort when the app runs; a suspended or terminated
app can retain the previous icon until reopening. The OS may show its usual
icon-change alert.
Code: `apps/mobile/src/utils/seasonal-appearance.ts`;
`apps/mobile/components/appearance/theme-app-icon.ts`;
`apps/mobile/components/stats/muscle-body-card.tsx`.

### appearance.ink-paper-mode · presentation · accepted

Ink + paper draws the same in light, dark and system mode: a dark page under
light cards. While it is chosen, Settings → Appearance offers no Mode, and
Settings home names the preset alone. The stored mode is kept, and a preset
that takes a mode draws in it again.

Why: a mode choice that changes nothing reads as broken, and a second, darker
Ink + paper would dim its cards below the text floors.
Code: `apps/mobile/components/ui/theme-presets.ts` (`choiceTakesMode`);
`apps/mobile/components/appearance/appearance-settings.tsx`;
`apps/mobile/components/appearance/chosen-theme.ts`.

### appearance.solid-bars · presentation · accepted

Only a Custom theme's Chart part offers Solid bars, off by default and on no
preset. On, every bar mark takes the ramp's end (`viz4`) instead of its step:
Today's and a group's board bars, the week-figure and At a glance lap bars,
and Recovery's trained days. Laps past the first and the board leader then
show only in their figures and rank. Heatmap tiles and the body map keep the
ramp.

Why: a user who wants one bar colour gets it without flattening the ramp that
grades intensity.
Code: `apps/mobile/components/ui/theme-context.tsx` (`useBarFills`);
`apps/mobile/components/ui/theme-presets.ts` (`appearanceSolidBars`).
