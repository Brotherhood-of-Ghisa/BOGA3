# Product review

A prompt any agent runs on a change, checking it against the product decisions
in this directory — not code quality (that is `/code-review`).

## Inputs

- Every `*.md` in `docs/product/` except this one: the facts.
- The change: a PR diff (`gh pr diff <n>`) or a branch diff against
  `origin/main`, plus the PR title and body if there is one.
- The repository at the change's base, for context only (what a component
  renders, which function a screen calls).

## Method

1. Read every fact. Note each fact's status and any `Pending:` line.
2. For each changed file, ask what a user could now observe differently: which
   figures, counts, rows, labels or words, on which screens. Shared
   calculation or aggregation code reaches every screen that reads it.
3. Compare each observable change with the facts:
   - it alters a rule at its source, so the product now follows a different
     rule than an accepted fact states (a shared predicate, constant,
     formula, setting or default changes; or several screens move together;
     or the diff's own specs or tests are rewritten to the new rule) →
     **changes**;
   - one place diverges from an accepted fact that the rest of the product
     still follows (a screen, string or calculation that is simply wrong) →
     **violates**;
   - it settles the question of an `open` fact → **answers**;
   - it makes a product choice no fact covers (a new counting, eligibility,
     display or wording rule) → **new decision**;
   - a line the diff adds to a doc, comment or UI string states a fact's
     rule in its own words instead of citing `[[id]]` → **restates**. Lines
     the diff does not add are out of scope (whole docs: Audit mode);
   - the diff makes a fact's own line false or redundant — it describes a
     layout the diff redesigned, or detail the code and its tests now pin
     that no builder would need the product owner to change →
     **over-specified**. This is the only class that takes words out, so
     look for it on every diff that touches a screen a fact describes.

   When unsure between **changes** and **violates**, choose **changes**: the
   product owner decides either way.
4. A change that moves code towards a fact's `Pending:` line, citing the
   fact, is the intended implementation: no finding.
5. Drop anything you cannot tie to a concrete line of the diff.

## Output

One line per finding, most severe first, then a one-line verdict:

```text
<class> <fact id or "none"> — <file>:<line> — <what a user would observe, one sentence>
Verdict: clean | needs decision | needs fix
```

- **violates** → `needs fix`.
- **changes**, **answers**, **new decision** → `needs decision`: the
  product owner decides, as a `docs/product/**` change in this PR or its
  own, before this change merges.
  For a new decision, propose the fact (ID, kind, statement) in one line.
- **restates** → `needs fix` (replace with `[[id]]`).
- **over-specified** → `needs decision`: name the fact's lines to drop.
- No findings → `Verdict: clean`. Do not pad with style or code remarks.

## Audit mode

Run it after any PR changes a fact: old wording lingers in the docs
that restated it.

- **Input:** every persistent doc (tracked `*.md` outside `docs/plans/**`,
  `docs/brainstorms/**` and this directory) instead of a diff, plus the facts.
- **Classes:** the same, but report only **restates** (the doc states a
  fact's rule in its own words instead of citing `[[id]]`), **violates**
  (the doc states a rule an accepted fact contradicts) and **over-specified**
  (a fact's line the code has outgrown). A spec describing how the code
  implements a fact, while citing it, is neither of the first two.
- **Output:** as above, with the doc's `<file>:<line>`; verdict `clean` or
  `needs fix`. `docs-check` already fails on a fact's literal `Signature:`
  text; the audit finds the paraphrases.
