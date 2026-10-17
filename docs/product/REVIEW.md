# Product review

A prompt any agent runs on a change, checking it against the product decisions
in this directory — not code quality (that is `/code-review`).

## Inputs

- Every `*.md` in `docs/product/` except this one: the facts.
- The change: a PR diff (`gh pr diff <n>`) or a branch diff against
  `origin/main`, plus the PR title and body if there is one.
- The repository at the change's base, for context only.

## Method

1. Read every fact. Note each fact's status and any `Pending:` line.
2. For each changed file, ask what a user could now observe differently
   (figures, counts, rows, labels, words) and where. Shared calculation code
   reaches every screen that reads it.
3. Compare each observable change with the facts:
   - it moves a rule at its source away from an accepted fact (a shared
     predicate, constant, formula, setting or default; several screens
     moving together; specs or tests rewritten to the new rule) →
     **changes**;
   - one screen, string or calculation diverges from an accepted fact the
     rest of the product follows → **violates**;
   - it settles the question of an `open` fact → **answers**;
   - it makes a product choice no fact covers (a new counting, eligibility,
     display or wording rule) → **new decision**;
   - an added doc, comment or UI line states a fact's rule in its own words
     instead of citing `[[id]]` → **restates** (whole docs: Audit mode);
   - the diff makes a fact's line false or redundant (a redesigned layout,
     or detail the code and tests now pin) → **over-specified**. It is the
     only class that takes words out: check every diff touching a screen a
     fact describes.

   When unsure between **changes** and **violates**, choose **changes**: the
   product owner decides either way.
4. Code moving towards a cited fact's `Pending:` line: no finding.
5. Drop anything you cannot tie to a concrete line of the diff.

## Output

One line per finding, most severe first, then a one-line verdict:

```text
<class> <fact id or "none"> — <file>:<line> — <what a user would observe, one sentence>
Verdict: clean | needs decision | needs fix
```

- **violates** → `needs fix`.
- **changes**, **answers**, **new decision** → `needs decision`: the
  product owner decides, in a `docs/product/**` change, before merge. For a
  new decision, propose the fact (ID, kind, statement) in one line.
- **restates** → `needs fix` (replace with `[[id]]`).
- **over-specified** → `needs decision`: name the fact's lines to drop.
- No findings → `Verdict: clean`. Do not pad with style or code remarks.

## Audit mode

Run it after any PR changes a fact, to catch old wording elsewhere.

- **Input:** every persistent doc (tracked `*.md` outside `docs/plans/**`,
  `docs/brainstorms/**` and this directory) instead of a diff, plus the facts.
- **Classes:** only **restates**, **violates** (the doc contradicts an
  accepted fact) and **over-specified**. A spec describing how code
  implements a fact it cites is neither of the first two.
- **Output:** as above, with the doc's `<file>:<line>`; verdict `clean` or
  `needs fix`. `docs-check` catches literal `Signature:` text; the audit
  finds paraphrases.
