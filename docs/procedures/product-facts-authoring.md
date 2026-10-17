# Product facts authoring

Load when writing, changing or adding a fact in `docs/product/`, or changing
its checks. Facts are read through `docs/product/README.md`; this doc holds
only what an author or a check needs.

## Subjects

Each question belongs to one subject/file. Add a new subject in its own PR,
with a row in `docs/product/README.md`.

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
- **Status**: `accepted`, `open` or `superseded-by: <id>` (meanings:
  `docs/product/README.md`).
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
outside `docs/product/` in a paragraph not citing its fact. `./boga docs
budgets` prints statement sizes.

## Changing a fact

1. A fact may change in its own PR or in the PR that implements it. The
   product owner's approval is the decision; the PR body names each fact ID
   it changes.
2. Implementation PRs cite the fact IDs they implement and remove its
   `Pending:` line when the code matches.
