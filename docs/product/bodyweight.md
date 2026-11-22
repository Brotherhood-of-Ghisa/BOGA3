# Bodyweight

### bodyweight.health-import · definition · accepted

Apple Health weight importing is an independent opt-in on each phone/account.
Only measurements from its first enable instant onward are imported; disabling
and re-enabling never admits earlier history. Imported values and measurement
times are read-only in BoGa and used by default. Each reading can be ignored
and used again; that choice syncs and survives re-import. Ignore excludes the
reading from calculations while keeping it visible. Source deletions hide it.
Manual readings remain editable. Importing never enables bodyweight calculations.

Why: keep the Health source authoritative while giving the person control over calculation inputs.
Code: `apps/mobile/src/health-import/bodyweight-lifecycle.ts`;
`apps/mobile/src/data/bodyweight.ts`;
`apps/mobile/components/bodyweight/body-weight-screen.tsx`.
