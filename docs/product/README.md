# Product facts

Each product decision has one stable ID here. Specs cite facts as
`[[set.eligibility]]` and describe their implementation.

- **Status**: `accepted` is decided; `open` is undecided, so a builder who
  needs it stops and asks; `superseded-by: <id>` names its replacement.
- `Why:` is the reason, for cases a fact does not list. `Pending:` names where
  the code does not yet match.
- If you are writing or changing a fact, load
  `docs/procedures/product-facts-authoring.md`. Before opening a PR, run
  `docs/procedures/product-review.md` on its diff.

## Subjects

| Subject | File | Covers |
| --- | --- | --- |
| `set` | `set.md` | A performed set, which sets feed which figure, set counts and rows |
| `1rm` | `1rm.md` | The 1RM estimate, display and RM curve analytics |
| `muscle` | `muscle.md` | How sets and work are attributed to muscles |
| `copy` | `copy.md` | Words on screen: titles, subtitles, explanations |
| `comparison` | `comparison.md` | Which periods are compared, and how a change is shown |
| `notifications` | `notifications.md` | Group alerts: recipients, defaults, batching, freshness |
| `groups` | `groups.md` | Group competition: certification's scope and end |
| `appearance` | `appearance.md` | App icon selection and the default fallback |
| `gym` | `gym.md` | Per-gym exercise reporting |

Facts govern app-wide rules; screen layout belongs in `docs/specs/ui/screen-map.md`,
`docs/specs/ui/components-catalog.md`, component READMEs and tests.

Volume, records, sessions, bodyweight, group scoring and summary/comparison rules:
`docs/specs/tech/training-metrics-contract.md` owns them.
