# Product facts pilot

Proposal for capturing product decisions (what a working set is, how 1RM is
calculated, what a set row shows, "no subtitles") so they are decided once,
stored once, and checked on every PR. Pilot on one area, back-test it against
last week's PRs, then decide whether to expand.

## Problem

Between 2026-10-02 and 2026-10-05 "which sets count" was redefined about four
times across ~15 PRs:

| PR | What happened |
| --- | --- |
| before | Working set = near-failure (`WORKING_SET_POLICY.maxRir`) |
| #464 | Every non-warm-up set is a working set; #465 fixed `main` after #462 merged in parallel under the old rule |
| #468 → #472, #476, #480, #481, #484 | Warm-ups leave every statistic; the `N (W)` side-by-side counts collapse to one `Sets`. The question "surfaced while executing" another task |
| #487, #488, #489, #492 | Clean-up: one predicate, one doc, dead copies dropped; groups re-aligned with personal |
| #497 | Inside a Progress *preferences* PR: independent Working set and Volume eligibility per effort, personal only. Groups now differ from personal. #503 re-aligned an in-flight plan |
| #548 | Two UI docs still carried stale wording |

The operator's four remembered slips (what counts as a working set; all vs
working vs both side by side; which sets count for Volume; group vs personal)
are all this one concept. Copy rules show the same pattern: "no inline
explanation" is written nowhere, yet #501 (formula footnote), #504 ("So far"
label) and #535 (repeated footer sentences) each enforced it after the fact.
"No subtitles" exists only as a soft "use a subtitle only when…" in
`docs/specs/08-ux-delivery-standard.md`.

Diagnosis:

1. **Undecided, not forgotten.** Most slips were decisions nobody had made, so
   feature PRs made them implicitly (#497 is the clearest case).
2. **Ownership per document, not per fact.** The warm-up rule is stated in
   the metrics contract, `design-language.md`, `ux-rules.md` and two design
   targets; each restatement can drift.
3. **Routing by guesswork.** AGENTS.md's "if your task touches X, load Y"
   relies on the agent recognising that a Progress table change is a metrics
   change. Nothing checks the diff against the rules afterwards.
4. **Late and costly changes.** Each redefinition bumped a rules version
   (`EXERCISE_SESSION_FACTS_RULES_VERSION`, `GROUP_EVAL_RULES_VERSION`) and
   #513 was needed to keep certifications across rule changes.

Three people committed last week, on at least two harnesses (Claude Code and
Codex), so everything below is plain repo files plus AGENTS.md routing.

## Design

### Where facts live

`docs/product/`, separate from `docs/specs/**`:

- `README.md`: the subject glossary, the fact format, the rules below.
- One file per subject: `set.md`, `1rm.md`, `volume.md`, `muscle.md`,
  `copy.md`, and later more.
- `REVIEW.md`: the product-review prompt (harness-neutral).

Specs keep architecture, process and *how the code implements* a fact
(predicates, rules-version bumps, SQL). A spec cites the fact; it never
restates it. Product facts are what a user could observe or the product owner
would decide.

### Fact format

One heading per fact, with a parseable header line, inside its subject file:

```markdown
### set.eligibility · definition · accepted

<statement, or a decision table>

Why: <one or two sentences>
Code: `isWorkingSet`, `isVolumeSet` in `apps/mobile/src/exercise-calculations/set-semantics.ts`
Examples: <table rows Jest runs, or good/bad pairs for principles>
```

- **ID** `<subject>.<slug>`, stable forever. Superseding keeps the old ID with
  status `superseded-by: <id>`, so "why is it like this" has an answer.
- **Kind** is one of `definition`, `calculation`, `presentation`,
  `principle`. Owner = (subject, kind): there is exactly one place for "how
  1RM is calculated" (`1rm`, calculation) or "what a set row shows" (`set`,
  presentation). A fact that fits no subject means adding a subject on
  purpose.
- **Status** is `accepted`, `open` (an undecided question, recorded so a
  builder stops instead of deciding it) or `superseded-by: <id>`. Only the
  product owner moves a fact to `accepted`.
- **Decision tables over prose** for eligibility-style rules: an empty or
  surprising cell is visible in a table and invisible in a paragraph.
- **Executable examples** for definitions and calculations: a Jest test parses
  the tables marked `<!-- fact-table: <id> -->` and runs each row through the
  real predicate/function, so fact and code cannot diverge.
- **References** from other docs are `[[set.eligibility]]`. `docs-check`
  fails on an unknown ID. Code is not annotated; the fact's `Code:` line is
  the link, and `docs-check` already fails when a cited path disappears.

### The whole corpus is loadable at once

`docs/product/` gets one combined word budget (pilot: 6,000 words). Small
enough that a builder or reviewer loads **all of it**, every time. That
removes the routing problem instead of indexing around it. A path → fact
index (`./boga product for`) is an optional later addition if the corpus
outgrows the budget.

### Process

1. **Decision PR first.** A change to an accepted fact, or an answer to an
   open one, ships as its own PR touching only `docs/product/**`, approved
   by the product owner. Implementation PRs cite it. With the CI fast path
   below, that PR costs minutes, not a review cycle.
2. **Builders** load `docs/product/` (AGENTS.md "Always load") and stop on an
   `open` fact their change needs: propose the decision PR, do not decide.
3. **Product review** runs at PR time from `docs/product/REVIEW.md`, by any
   harness, alongside `/code-review`. Input: the diff plus the whole corpus.
   Finding classes:
   - *violates* `<id>`;
   - *changes* `<id>` without a decision PR;
   - *answers* open `<id>`;
   - *new decision*, not recorded: propose a fact;
   - *restates* `<id>` in another doc or a code comment.
4. **PR template** gains one line under Tests: `Product facts: <ids touched>
   | none`, with the review's result.

### Fast CI for docs-only PRs

Measured: `docs-check` has a 0.5 s local median (226 runs), yet every PR,
docs-only included, takes ~3 minutes in CI (#573, #572, #568, #554: 3 m
each), because `ci.yml` always runs `npm ci`, lint, typecheck, Jest, and the
agent-auth-web and MCP suites. Locally, `./boga test for` already maps a
docs-only diff to `docs-check` alone.

Change: a first step computes `git diff --name-only origin/main...HEAD`. If
every path is `docs/**` or a root-level `*.md`, the job runs `docs-check`
and stops; otherwise it runs everything. Doing it with step-level `if:`
inside the one job keeps the required check's name and avoids the "skipped
required check" trap. Meta-tests are skipped too: they test `scripts/`,
which a docs-only diff cannot touch. Measure the CI time after the change;
the target is under a minute.

## Draft facts (pilot content, for the product owner to react to)

Statements below are today's rules from
`docs/specs/tech/training-metrics-contract.md` and `docs/specs/ui/ux-rules.md`,
reshaped, not changed, except where marked **open** or **decided** (see
"Decisions from drafting").

### set.performed · definition

A set counts for anything only when it is confirmed performed: valid Weight
(blank with valid reps = 0) and reps (positive integer), and no
`performance_status`. Planned, unperformed and legacy-skipped rows never
count.

### set.eligibility · definition

Which performed sets feed which figure. Personal columns are the defaults of
the account-local effort policy (Settings → efforts); groups and coaching use
a fixed rule.

| Effort label | Personal: Sets, sessions, 1RM / Weight records | Personal: Volume, Volume records | Groups and coaching: every figure |
| --- | --- | --- | --- |
| Warm-up | no (default) | no (default) | no |
| Unspecified | yes (default) | yes (default) | yes |
| RIR 4 … RIR 0 (and stored RIR > 4) | yes (default) | yes (default) | yes |
| Technique | no (default) | no (default) | **no** (decided; code still yes) |
| Cooldown | no (default) | no (default) | **no** (decided; code still yes) |
| Unknown stored label | follows Unspecified | follows Unspecified | yes |

Every performed row still shows its own 1RM and volume
([[set.row-figures]]). A session counts when it holds at least one working
set.

### set.count-display · presentation

An unqualified `Sets` is the working-set count, on every screen and the share
image. Never show all-sets and working-sets side by side. Only plain row
counts count every row: `n of m sets done` and the remove-exercise alert.

### set.row-figures · presentation

Every set row shows every figure it can compute (Weight, reps, 1RM, Volume),
planned and warm-up rows included; unrealised figures are faded. A warm-up's
1RM is real but describes that row only: never a record, PR or best. The only
highlight is the exercise's one record set.

### 1rm.formula · calculation

Wathan: `1RM = 100 × load / (48.8 + 53.8 × e^(−0.075 × reps))`, shown to one
decimal, except a single (reps = 1), whose 1RM is its load. Zero load gives 0
(valid, never a record).

| Load kg | Reps | 1RM shown |
| --- | --- | --- |
| 100 | 5 | 116.6 |
| 100 | 10 | 134.7 |
| 60 | 12 | 84.9 |
| 0 | 8 | 0 |
| 100 | 1 | 100.0 (**decided**: a single's 1RM is its load; code shows 101.3) |

### muscle.set-count · definition · **open**

One rule, to be decided, then applied on every screen. Two screens count
"sets for a muscle" differently today:

- Session summary "Sets by muscle": primary sets + ½ secondary sets.
- Progress muscle comparisons: each physical set counts 1 for every mapped
  muscle, primary or secondary.

### copy.no-subtitles · principle

A title stands alone: no line under a screen, card or section title that
describes it.

- *Test:* delete the line. If the user loses only words about the thing, it
  was a subtitle. If they lose a value (a date, a duration, a count,
  `3 sets · 1RM 102.5`), it is data and stays.
- *Bad:* "Your training at a glance" under `Today`.
- *Good:* `Mon 6 Oct · 52 min` under a session title.

### copy.no-inline-explanation · principle

Screens show data and controls, not sentences about them: no footnotes,
formula notes, hints under fields, or "how this works" lines.

- *Test:* if the sentence is about a figure or a control rather than being
  content, remove it. If the meaning is unclear without it, fix the label or
  the design.
- *Cases:* #501 (sets formula footnote), #504 (bare "So far"), #535 (repeated
  weekly history footers).
- *Exceptions* (decided): 
  1. **Errors**: one line saying what failed, plus the action (Retry).
  2. **Empty states**: one line saying what will appear here; no tutorial.
  3. **Destructive confirmations**: the system alert states what will be lost
     (`its N sets`).
  4. **Consent and permission text**: the agent-consent page must state the
     access granted.
- Mechanical part, for `ui-guardrails`: flag a `subtitle` prop on shared
  header components and caption/footnote text variants in `app/**` screens.

## Decisions from drafting

Asked of and answered by the product owner on 2026-10-06. Each ships as its
own decision PR, then an implementation PR.

1. **Technique and Cooldown in group and coaching figures.** The divergence
   from personal defaults is not intended: groups and coaching exclude them
   too, so the fixed rule equals the personal defaults. Implementation needs a
   `GROUP_EVAL_RULES_VERSION` bump and an agent API `metric_revision` bump.
2. **A muscle's set count.** Still open, with a constraint: one rule, applied
   consistently on every screen (Session summary today uses ½ for secondary,
   Progress counts 1 per mapped muscle). Stays `open` in `muscle.set-count`
   until decided.
3. **A single's 1RM.** A 1-rep set's 1RM is its load (`100 × 1` shows
   `100.0`, not `101.3`). Tentative ("I think so"): confirm in the decision
   PR. Implementation bumps `EXERCISE_SESSION_FACTS_RULES_VERSION`, since
   records can change.

## Back-test (does the reviewer earn its keep?)

Run `REVIEW.md` on historical diffs before wiring anything into the process.

- **Decision detection.** Facts as of each PR's base (reconstructed from
  `git show <base>:docs/specs/tech/training-metrics-contract.md`), diff of
  #464, #484, #496, #497. Expected: *changes* `set.eligibility` /
  `set.count-display` / `muscle.set-count`; #497 must be flagged.
- **Violation detection.** Current facts, the diffs that *introduced* the
  #501, #504 and #535 copy (found with `git log -S`). Expected: *violates*
  `copy.no-inline-explanation`.
- **Controls.** #552 (custom colour), #549 (dev stack), #541 (exercise
  picker). Expected: no findings, or only true ones.

Pass: 6 of the 7 expected findings, and no more than one false positive across
the controls. Record results in the pilot PR body.

## Sequence

| # | PR | Gates |
| --- | --- | --- |
| 1 | CI fast path for docs-only PRs (`ci.yml` step guards) | `fast`; CI time measured before/after on a docs-only PR |
| 2 | `docs/product/` with README, the facts above, `REVIEW.md`; back-test run; open questions answered as decision rows | `docs-check` (fast CI) |
| 3 | Wire it in: `docs-check` parses fact headers and `[[id]]` refs and budgets the corpus; Jest runs fact tables; AGENTS.md always-loads `docs/product/`; PR template line | `fast`, `jest-coverage`, `complexity`, `dependencies` |
| 4 | De-duplicate: metrics contract §1, `ux-rules.md` "Sets and figures", `design-language.md` and design targets cite facts instead of restating them; soften `08` subtitle rule into a reference | `fast` |
| 5 | Implement decisions 1 and 3 (separate PRs, after their decision PRs); decide 2 | per change: decision 1 touches groups (`backend`, `groups-api-live`, `ios-groups-e2e` rows), decision 3 touches metrics (`fast` + facts rebuild pins) |

Stop after #2 if the back-test fails: the facts may still be worth keeping,
but the reviewer is not, and #3 shrinks to docs-check plus AGENTS.md.

## Out of scope for the pilot

Records, sessions, bodyweight, groups-only scoring, navigation and layout
rules. They move in once the pilot passes, one subject per PR.
