# Product facts

The product decisions BOGA is built to: what a working set is, how 1RM is
calculated, what a set row shows, how screens use words. Each decision is
stated once, here, with a stable ID. Specs describe how the code implements a
fact; they cite it and never restate it.

**Pilot status.** This corpus covers sets, 1RM, muscle set counts and screen
copy. It is not yet routed from `AGENTS.md`; until it is, where a spec and a
fact disagree, the fact records the decision and the spec records today's
code (see each fact's `Pending:` line).

## Subjects

A question belongs to exactly one subject, and that subject's file is the only
place it is answered. A fact that fits no subject means adding a subject on
purpose, in its own PR.

| Subject | File | Covers |
| --- | --- | --- |
| `set` | `set.md` | What a performed set is, which sets feed which figure, how set counts and set rows are shown |
| `1rm` | `1rm.md` | The 1RM estimate and its display |
| `muscle` | `muscle.md` | How sets and work are attributed to muscles |
| `copy` | `copy.md` | Words on screen: titles, subtitles, explanations |

Not yet here: volume totals, records, sessions, bodyweight, groups-only
scoring. Until they move in, `docs/specs/tech/training-metrics-contract.md`
owns them.

## Fact format

```markdown
### <subject>.<slug> · <kind> · <status>

<statement or decision table>

Why: <one or two sentences>
Code: <where it is implemented>
Pending: <only when the code does not yet match>
```

- **ID** never changes. A replaced fact keeps its heading with status
  `superseded-by: <id>` and one line saying what changed.
- **Kind**: `definition` (what something is), `calculation` (how a figure is
  computed), `presentation` (how something is shown), `principle` (a rule
  applied by judgement, with a test, examples and exceptions).
- **Status**: `accepted`, `open` (undecided: a builder who needs it stops and
  asks), or `superseded-by: <id>`.
- **Tables over prose** for rules with cases; every cell is a decision.
- **Examples** for definitions and calculations are table rows a test can run.
  Principles grow by cases: each review verdict the product owner gives is
  added as a case.
- **Reference** a fact from any doc as `[[set.eligibility]]`.

## Changing a fact

1. A decision PR touches only `docs/product/**`. The product owner approves
   it; that approval is the decision.
2. Implementation PRs cite the fact IDs they implement and remove its
   `Pending:` line when the code matches.
3. A builder never changes an accepted fact or answers an open one inside a
   feature PR.

## Reviewing a change against the facts

`REVIEW.md` is the prompt. Any agent runs it on a diff with this whole
directory loaded.
