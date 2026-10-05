# Accepted target — the Train page (Claude Design canvas)

Target record per `../ai-design-policy.md`. Accepted by the user on
2026-10-05 from a Claude Design canvas drawn in the app's vocabulary. It
replaces the Train layout of the design-language move (a `PageHeader`, one
`SectionHeader` per section and a card per action).

## Target

- Canvas: <https://claude.ai/artifact/NTREbQVX7HGfeEKz15zay4> (2026-10-05).
  Artboards: `Train · idle (disc)`, `Train · plan ready`, `Train · planning,
  nothing planned`, and the states `checking for a workout`, `check failed`,
  `start failed`. A full-width slab (declined) and a Resume disc (rejected:
  no resume button) were removed.
- Vocabulary: `../design-language.md`. The plan name, exercise count and start
  time on the canvas are invented.

## Brief

- **No title and no explanatory copy.** The tab strip names the page, as on
  Today and Progress.
- **One large disc**: a 232pt `accent` circle inside a thin `rule` ring, the
  `play` glyph over `START` (Archivo 800). It is the screen's only `accent`
  and always starts an empty workout (chosen over a full-width slab and over
  the disc starting a ready plan).
- **Planning sits beneath, only when it has something to say.** Unavailable
  (today's production) or loading: nothing — no placeholder. A ready plan: the
  disc a step smaller (204pt), a `Planned` micro-label, one `Card` row (name,
  detail, outline `Start`) and a `Manage planning` text button. Planning on,
  nothing planned: one `Plan a workout` text button. A planning read error: the
  `StatePanel` error recipe with Retry.
- **A workout in progress is Train.** There is no Resume button. Pressing the
  Train tab opens that session view directly, from any screen with the tab
  strip; on the session view of that workout the Train tab does nothing. Train
  reached any other way (a link, Today's `Open Train`) replaces itself with
  the session view once its read finds the workout. Start (and a planned
  start) replaces Train with the new session view, so going back from a
  workout never lands on Train.
- **States.** Checking for a workout (and while a found workout opens): the
  disc greyed to `ink-ghost` and disabled. Check failed: the `Couldn't check your workouts` `StatePanel` with
  Retry. Start failed: one `danger` line under the disc, `Couldn't start. Try
  again.`

## States

Device: iPhone 17 Pro simulator, light. Runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence; no target
screenshots are committed. Jest owns the planning states, which production
cannot reach until planning ships (`__tests__/train-screen.test.tsx`); the tab
routing is `__tests__/train-tab-entry.test.tsx` and step 1 of
`session-view.yaml`.
