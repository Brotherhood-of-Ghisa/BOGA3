# Product facts authoring

Load when writing, changing or adding a fact in `docs/product/`, or changing
its checks. Facts are read through `docs/product/README.md`; this doc holds
only what an author or a check needs.

## Is it a fact?

Keep the set minimal. A rule is a fact only when all three hold:

1. **Cross-cutting:** it governs two or more surfaces, or shared code they
   all read.
2. **Not recoverable:** the one file its `Code:` line names would not reveal
   it.
3. **Easy to break:** a reasonable builder could change it without noticing
   it was a product decision.

Otherwise pin it with a test whose name states the rule, and put any reason
in a comment beside the code. A fact never restates its code: name the
decision and point to the code, and leave thresholds, formulas and layout to
the code and its tests.

**Merge** two facts only when changing one always changes the other; facts
that can change independently stay apart. `docs-check` caps the number of
facts (`facts` row in `scripts/doc-budgets.tsv`): a new fact past the cap
first cuts or merges one, or gets the operator's agreement to raise it.

## Subjects

Each question belongs to one subject/file. A new subject adds a row and its
load trigger in `docs/product/README.md`. A fact that
changes what its subject covers updates that trigger.

## Fact format

```markdown
### <subject>.<slug> · <kind> · <status>

<statement or decision table>

Why: <one or two sentences>
Code: <where it is implemented>
Pending: <only when the code does not yet match>
Signature: `<text>`, `<text>`  (optional)
```

- **ID** never changes. A replaced fact is deleted, and every `[[id]]`
  citing it is re-pointed; git keeps its history.
- **Kind**: `definition` (what something is), `calculation` (how a figure is
  computed), `presentation` (how something is shown, and only where another
  choice would be a product mistake rather than a design iteration),
  `principle` (a rule applied by judgement, with a test and its exceptions).
- **Status**: `accepted` (decided) or `open` (undecided; a builder who needs
  it decides it). `Pending:` names where the code does not yet match.
- **Tables over prose** for rules with cases; every cell is a decision.
- **Small**: a statement — the header down to `Why:`, examples excluded — is at
  most 130 words. Longer usually describes a screen: split it into its
  decisions, or leave render detail to its component and tests. Keep a line
  only if changing it would be a product decision.
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
status, a `[[id]]` naming no fact, a statement over the cap, more facts than
the cap, and a signature outside `docs/product/` in a paragraph not citing its
fact. `./boga docs
budgets` prints statement sizes.

## Changing a fact

1. A fact may change in its own PR or in the PR that implements it. No
   sign-off is needed, but every product change — a new fact, a changed
   `accepted` fact, a decided `open` fact — is highlighted so humans see it:
   in the plan while planning, and in the PR body, whose `Product facts:` line
   names each such ID. The product reviewer (`product-review.md`) checks none
   is missed.
2. Implementation PRs cite the fact IDs they implement and remove its
   `Pending:` line when the code matches.
