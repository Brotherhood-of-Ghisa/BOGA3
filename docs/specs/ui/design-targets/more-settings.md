# Accepted target — More and Settings (repo-native brief)

Target record per `../ai-design-policy.md`, for DLM-T04 of the design-language
migration. Chosen by the user on 2026-09-24 (plan decision G1 (a)): a brief plus
the gallery states the user accepts. Logs, Settings' Developer tools and the
Maestro harness are dev-only (plan G8): a mechanical restyle, captured for
information only. **Accepted** by the user in the DLM-T04 gallery on 2026-09-25.

## Target

- Vocabulary: `../design-language.md` and the app frame (`app-frame.md`).
- This brief, plus the gallery states below. No artboards.

## Brief

- More and Settings are `paper` under a `PageHeader`. Each section is an
  `ink-muted` micro-label over one `Card` of hairline `ListRow`s: a leading
  glyph in `ink-muted` (no badge, T04-D1), the label and an `ink-muted`
  description, and a trailing `chevron-right`, or `arrow-up-right` for the
  external setup link. A failed browser launch shows `danger` text under its row.
- Settings' date format is a `SegmentedControl` (T04-D3). The signed-out sync
  guidance is a `StatePanel` in a `Card`. About is a `Card` of text rows.
- The sync-status panel is a `Card` of `ListRow`s: the labels in body text,
  the values in Plex Mono.
  Offline is the `offline` (wifi-off) glyph plus "Offline" in `ink`, never a
  warning hue (G3); an unknown network (before NetInfo reports) is "Checking…"
  with no glyph; a cycle error is `danger`. `Refresh` is an outline.
- Neither screen has an `accent` button.
- Developer tools (dev builds only) is one `Card` headed by the `warning` glyph
  and a micro-label. Its buttons are outlines, `Wipe remote` an outline in
  `danger`, and each outcome a `Notice` (`success` glyph, or `danger`).
- Logs filters by level with a single-select `ChipGroup` and clears with a text
  button. The rows share one `Card`: an error is `danger`, a warning `ink` with
  the `warning` glyph, info `ink-muted`, debug `ink-faint`, and the context
  Plex Mono.

## States

Device: iPhone simulator at 390pt width, light.

| Screenshot (lane) | State |
| --- | --- |
| `04-m26-more` (`ios-smoke`) | More, signed out |
| `06-settings-sections-top` (`ios-auth-profile`) | Settings, signed in: Account and AI coaching |
| `07-settings-about-metadata` (`ios-auth-profile`) | Settings: About |
| `settings-preferences` (`ios-ui-regression`) | Settings: the date format |
| `19-first-run-roundtrip-delta-synced` (`ios-sync-e2e`) | the sync-status panel after a sync |
| `02-dev-wipe-local-settings`, `03-dev-wipe-local-feedback` (`ios-ui-regression`) | Developer tools, and a success `Notice` (information only) |
| `dev-logs` (`ios-ui-regression`) | Logs (information only) |

Jest only (no flow reaches them): the signed-out sync card, the offline,
unknown-network and error sync panel, a failed dev action, and the
external-link error.

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
