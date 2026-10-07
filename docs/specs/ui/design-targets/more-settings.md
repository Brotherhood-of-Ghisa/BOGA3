# Accepted target — More and Settings (repo-native brief)

Target record per `../ai-design-policy.md`. Chosen by the user on 2026-09-24:
a brief plus the gallery states the user accepts. Logs, Settings' Developer tools and the
Maestro harness are dev-only: a mechanical restyle, captured for
information only. **Accepted** by the user in the gallery on 2026-09-25.

## Target

- Vocabulary: `../design-language.md` and the app frame (`app-frame.md`).
- This brief, plus the gallery states below. No artboards.

## Brief

- More and Settings are `paper` under a `PageHeader`. Each section is an
  `ink-muted` micro-label over one `Card` of hairline `ListRow`s: a leading
  glyph in `ink-muted` (no badge), the label, an `ink-muted` value only where
  the row has one (the account's email), no describing line
  ([[copy.no-inline-explanation]]), and a trailing `chevron-right`, or `arrow-up-right` for the
  external setup link. A failed browser launch shows `danger` text under its row.
- Settings' date format is a `SegmentedControl`. The signed-out sync
  guidance is a `StatePanel` in a `Card`. About is a `Card` of text rows.
- The sync-status panel is a `Card` of `ListRow`s: the labels in body text,
  the values in Plex Mono.
  Offline is the `offline` (wifi-off) glyph plus "Offline" in `ink`, never a
  warning hue (G3); an unknown network (before NetInfo reports) is "Checking…"
  with no glyph; a cycle error is `danger`. `Refresh` is an outline.
- Preference-storage failures share Data & Sync's existing Error row with sync
  errors (operator decision, 2026-10-03). Retain both when they coexist; the
  existing Refresh retries preferences and refreshes sync when signed in.
  Signed-out/local-only failures use that same row and Refresh inside the
  existing guidance card. Preference controls add no error boxes or Retry buttons.
- Settings has a Progress section using the same Card, form-field and row
  vocabulary: one inline “Weekly working sets per muscle” field applying the same
  target to every muscle group, “Progress period (weeks)” and “History look-back
  (weeks)” fields, the sole Daily/Weekly selector labelled “Heatmap view”, and
  the operator's fixed effort table (2026-10-04): Warm-up, Unspecified, RIR-4–0,
  Technique and Cooldown, with Display, Working set and Volume columns. No Add
  control. Every checkbox has a 44pt target and a label naming its row and column.
  All Display defaults are on; the calculation columns' defaults, and the
  fixed group rule, are [[set.eligibility]]. Keep at least one Display choice;
  calculation columns may be empty. The columns are account-local on this
  device. Groups show no effort settings. This operator brief supersedes the earlier visibility-only
  controls. Numeric drafts commit on editing completion;
  invalid and unsaved drafts remain recoverable, with errors in Data & Sync.
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
| `07-settings-about-metadata` (ad hoc) | Settings: About |
| `settings-preferences` (ad hoc) | Settings: the date format |
| `settings-centralized-preference-save-error` (ad hoc) | Preference failure in Data & Sync, followed by Refresh recovery |
| `18-first-run-roundtrip-reading-synced` (`ios-sync-e2e`) | the sync-status panel after a sync |
| `02-dev-wipe-local-settings`, `03-dev-wipe-local-feedback` (ad hoc) | Developer tools, and a success `Notice` (information only) |
| `dev-logs` (ad hoc) | Logs (information only) |

`(ad hoc)` states are no longer captured by a lane: their flow keeps only
the claims that need a device (spec 06, "Maestro scope policy") and Jest
proves the rest. When the screen changes, capture them with a one-off flow
run (`apps/mobile/scripts/maestro-ios-run-flow.sh --flow …`); git history
holds the flow steps that reached them.

Jest only (no flow reaches them): the signed-out sync card, the offline,
unknown-network and error sync panel, a failed dev action, and the
external-link error.

No target screenshots are committed; runtime captures stay in the gitignored
`apps/mobile/artifacts/maestro/` tree and are linked as PR evidence.
