# Product review

A prompt any agent runs on a change. It checks the change against the product
decisions in this directory, not code quality (that is `/code-review`).

## Inputs

- Every `*.md` file in `docs/product/` except this one: the facts.
- The change: a PR diff (`gh pr diff <n>`) or a branch diff against
  `origin/main`, and the PR title and body if there is one.
- The repository at the change's base, for context only (what a component
  renders, which function a screen calls).

## Method

1. Read every fact. Note each fact's status and any `Pending:` line.
2. For each changed file, ask what a user could now observe differently:
   which figures, counts, rows, labels or words, on which screens. Changes to
   shared calculation or aggregation code reach every screen that reads it.
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
     the diff does not add are out of scope.

   When unsure between **changes** and **violates**, choose **changes**: the
   product owner decides either way.
4. A change that moves code towards a fact's `Pending:` line, citing the
   fact, is the intended implementation: no finding.
5. Drop anything you cannot tie to a concrete line of the diff.

## Output

One line per finding, most severe first, then a one-line verdict:

```text
<class> <fact id or "none"> — <file>:<line> — <what a user would observe, one sentence>
Verdict: clean | needs decision PR | needs fix
```

- **violates** → `needs fix`.
- **changes**, **answers**, **new decision** → `needs decision PR`: the
  product owner decides in a `docs/product/**` PR before this change merges.
  For a new decision, propose the fact (ID, kind, statement) in one line.
- **restates** → `needs fix` (replace with `[[id]]`).
- No findings → `Verdict: clean`. Do not pad with style or code remarks.
