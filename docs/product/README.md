# Product facts

Each product decision has one stable ID, `<subject>.<slug>`, kept in
`<subject>.md`. Load a subject's file when your task matches its trigger
below, or when a doc you load cites one of its facts (`[[set.eligibility]]`
is in `set.md`). When unsure, load it.

- **Status**: `accepted` is decided; `open` is undecided, so a builder who
  needs it stops and asks; `superseded-by: <id>` names its replacement.
- `Why:` is the reason, for cases a fact does not list. `Pending:` names where
  the code does not yet match.
- If you are writing or changing a fact, load
  `docs/procedures/product-facts-authoring.md`. Before opening a PR, run
  `docs/procedures/product-review.md`: it reads every fact.

## Subjects

| File | Load when your task touches |
| --- | --- |
| `set.md` | any set, set count, record, Volume or 1RM figure; set rows; completing an exercise |
| `copy.md` | any words on screen (every UI change); set entry; blank history cells |
| `comparison.md` | comparing periods or sessions, change figures (`+4`, `+12%`), history windows, weekly reference lines |
| `1rm.md` | the 1RM estimate or its display; the RM curve |
| `muscle.md` | attributing sets or work to muscles |
| `gym.md` | gyms, or how one exercise's history is grouped |
| `groups.md` | group competition and certification |
| `notifications.md` | any notification: group alerts, workout notifications |
| `appearance.md` | the app icon or the appearance theme |

Facts govern app-wide rules; screen layout belongs in `docs/specs/ui/screen-map.md`,
`docs/specs/ui/components-catalog.md`, component READMEs and tests.

Volume, records, sessions, bodyweight, group scoring and summary/comparison rules:
`docs/specs/tech/training-metrics-contract.md` owns them.
