# Product facts

Each product decision has one stable ID here. Specs cite facts and describe
their implementation; `Pending:` identifies gaps between decisions and code.

## Subjects

Each question belongs to one subject/file. Add a new subject in its own PR.

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

## Fact format

```markdown
### <subject>.<slug> · <kind> · <status>

<statement or decision table>

Why: <one or two sentences>
Code: <where it is implemented>
Pending: <only when the code does not yet match>
Signature: `<text>`, `<text>`  (optional)
```

- **ID** never changes. A replaced fact keeps its heading with status
  `superseded-by: <id>` and one line saying what changed.
- **Kind**: `definition` (what something is), `calculation` (how a figure is
  computed), `presentation` (how something is shown, and only where another
  choice would be a product mistake rather than a design iteration),
  `principle` (a rule applied by judgement, with a test and its exceptions).
- **Status**: `accepted`, `open` (undecided: a builder who needs it stops and
  asks), or `superseded-by: <id>`.
- **Tables over prose** for rules with cases; every cell is a decision.
- **Small**: a statement — the header down to `Why:`, examples excluded — is at
  most 130 words. Longer usually describes a screen: split it into its
  decisions, or leave render detail to its component and tests. Keep a line
  only if changing it would need the product owner.
- **Examples** for definitions and calculations are table rows a test can run.
  A principle carries at most three: one bad, one good, one kept exception;
  review verdicts stay in git and PR bodies.
- **Executable tables** carry `<!-- fact-table: <id> -->`; a Jest test
  (`apps/mobile/__tests__/product-fact-tables.test.ts`) runs every row through
  the real code. A row the `Pending:` line explains runs as an expected
  failure, so implementing it fails the test until that line goes.
- **Signature**: a few literal texts only a restatement of the fact would
  contain (a formula constant, an exact label). Principles rarely have one.
- **Reference** a fact from any doc as `[[set.eligibility]]`.

`docs-check` fails a malformed header, a duplicate ID, an unknown kind or
status, a `[[id]]` naming no fact, a statement over the cap, and a signature
outside this directory in a paragraph not citing its fact. `./boga docs
budgets` prints statement sizes.

## Changing a fact

1. A fact may change in its own PR or in the PR that implements it. The
   product owner's approval is the decision; the PR body names each fact ID
   it changes.
2. Implementation PRs cite the fact IDs they implement and remove its
   `Pending:` line when the code matches.

## Reviewing a change against the facts

Review diffs using `REVIEW.md`, with this directory loaded.
