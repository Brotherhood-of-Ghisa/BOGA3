# Fix plan: one definition each for counted sets, counted sessions, records and calculations

> Status: **decisions agreed** (2026-10-03; D4 changed by Dino, rest as recommended). Owner: Dino.
> Progress: PR 1 (#488), PR 2 (#487), PR 3 (#489) merged; PR 4 in review; PR 3b
> (D5's Weight-record display) needs a design target and deletes this plan.
> D8 corrected: Weight keeps one decimal on whole kg (`60.0`), per design-language §6.
> Source: the metrics-definitions audit run in this worktree on 2026-10-03.
> The decisions below need sign-off before PR 2 starts; PR 1 can start now.
> Working note: each PR moves the rules it ships into the owning spec, and
> the last PR deletes this file.

## Outcome

Each of these is defined by **one piece of code** and **one doc**. Every view
gets it from those two places and does not restate it:

| Definition | Rule | Code owner (target) | Doc owner (target) |
| --- | --- | --- | --- |
| Counted set | A confirmed performed set that is not a warm-up | `isWorkingSet` (`src/exercise-calculations/set-semantics.ts`) | new `docs/specs/tech/training-metrics-contract.md` §1 |
| Counted session | A completed session with at least one counted set (per exercise or per muscle: at least one counted set of that exercise or muscle) | new `isCountedSession` / `countedSessionIds`, same module | same doc §2 |
| Records (Vol, 1RM, Weight) | See D3–D6 | new `src/exercise-calculations/records.ts` | same doc §3 |
| Calculations (parse, load, volume, 1RM, top weight, display precision) | Unchanged formulas | `src/exercise-calculations/**` (parsing gets one owner, display gets a new `format.ts`) | same doc §4. `bodyweight-load-contract.md` keeps the bodyweight policy and links to §4 for the maths |

"One doc" means the other specs, READMEs and design targets **link** to the
contract and only say which figures a screen shows. The MCP tool descriptions
are the one exception: an LLM client reads them without links, so they keep a
one-line summary that a guard test checks for consistency.

## What the audit found (the work list)

The verdicts are in the session that produced this plan. These are the defects
the plan fixes, with the anchors as of `06d49059`.

**Sets**
- S1. The rule has a second name, `isWorkingSessionSetType`
  (`src/data/set-types.ts:35`). About 10 sites rebuild "confirmed and not
  warm-up" from two calls (`completed-session-detail-model.ts:58,114`,
  `session-view-model.ts:133,169`, `exercise-catalog-stats.ts:246,254`,
  `muscle-analytics.ts:114,154`, `session-insights/calculations.ts:181,261`,
  `exercise-block-history.ts:180,188`, `groups/session-metrics.ts:81`).
- S2. The validity checks disagree. `hasValidActualValues` uses `Number()`
  and accepts `1e3` and `0x10`; `parseSetWeight` rejects them; and
  `session-model.ts:124` is a third validator. As a result the session list
  and exercise history count sets that facts, muscle stats and agent-api drop.
- S3. Nothing prevents a new inline `'warm_up'` comparison.
- S4. Docs: `05-data-model.md:430` says a warm-up "still counts toward volume,
  heatmaps…", which contradicts §5.11 and the code. The rule is also restated
  in `05:133`, `ux-rules.md:663`, `groups-contract.md:395`,
  `bodyweight-load-contract.md:110`, the agent-api README "Working sets only",
  and `boga-mcp/README.md:36`.

**Sessions**
- C1. The Stats `Sessions` card (`src/data/stats.ts:187`) and Today
  week/month `Sessions` (`src/progress-summary/calculations.ts:123`) count
  every completed session, including ones that are warm-up-only or have no
  sets.
- C2. There is no session helper. Each of about 10 sites rebuilds "≥1 working
  set" its own way.
- C3. The group session card's `exerciseCount` (`groups/session-metrics.ts:83`)
  includes warm-up-only exercises. The SQL and agent-api counts exclude them.
- C4. `exercise-block-history.ts:201` applies `limit` before the working-set
  filter, so warm-up-only sessions take up slots.
- C5. The exercise-history tag/gym chip `occurrenceCount`
  (`exercise-history.ts:272-311`) counts blocks with no performed set.
- C6. The SQL handles null `working` differently in two places:
  `working is not false` (`20261003120000_group_results_working_sets.sql:79`)
  vs `f.working` (`:212`).
- C7. No doc defines the whole-session count. `groups-contract.md:1287`
  defines its own "sessions that count".

**Records**
- R1. "Session best" is implemented about 5 times: `best-set.ts` plus
  `pickTopWeight` (`exercise-session-facts-derive.ts:63`),
  `summarizeExerciseLoad` (`analytics.ts:62`), `deriveLastSession`
  (`exercise-records.ts:135`), `bestRecordSetId`
  (`exercise-page-model.ts:135`) and `exercise-catalog-stats.ts:211`.
  "All-time best" is implemented about 4 times: `createRecordTracker`,
  `pickBests`, `loadEarlierBestE1rmByDefinition`, the session-insights replay,
  and `agent-api/index.ts:914-928`.
- R2. The session view and completion flag 1RM records only. The exercise page
  also flags top weight.
- R3. The exercise page baseline follows the current-gym preference
  (`use-exercise-records.ts:64`); the session view always uses all gyms.
- R4. The exercise page picks a winner per block; the session view picks one
  across all blocks of the exercise.
- R5. Zero results: the docs (`ux-rules.md:40`,
  `bodyweight-load-contract.md:105`, the agent-api README) say a 0 result
  never makes a record. The facts, the exercise page and agent-api all accept
  0 as a best or a baseline.
- R6. The `pr_weight` flag needs a strictly heavier weight, but the holder
  (`pickBests`, `analytics.ts:75`, agent-api) also changes on equal weight with
  more reps. The records panel can therefore name a session that has no flag.
- R7. **Group bug.** `set-facts.ts:102` stores `e1rm_kg = 0` for 0 kg sets.
  The contract-1 board candidates only drop nulls
  (`20260916120000_m25_group_certification.sql:132`), and
  `group_board_entries` has `CHECK (value_kg > 0)`
  (`20260914120000_m25_group_boards.sql:49`). A member whose best counting set
  is 0 kg (for example a linked bodyweight exercise) would fail the board
  apply. Inferred from the code; not yet reproduced.
- R8. The contract-1 SQL multiplies Weight by the load factor
  (`…group_results_working_sets.sql:63`). `groups-contract.md:585` and
  `bodyweight-load-contract.md:214` say Weight stays raw, and contract 2
  (`performance-score.ts:40`) keeps it raw.
- R9. `groups-contract.md:394` says `e1rm_kg` is "null at 0 kg", but the code
  stores 0. It also cites the plan ID `M25-T05`, which specs must not do.

**Calculations**
- K1. The top-weight rule is copied 3 times (`analytics.ts:75`,
  `exercise-session-facts-derive.ts:63`, `agent-api/index.ts:914`). The
  contribution range check is copied twice (`load-metrics.ts:88`,
  `exercise-core/bodyweight-contribution.ts:7`).
- K2. Display precision has no owner. 1RM is 1 dp in the session view and
  exercise page, but a whole number in Stats and the history sheet. Volume is
  a whole number in most places, 1 dp on `exercise-volume-card.tsx:16`, and up
  to 2 dp plus "kg" in groups. Two formatter pairs are duplicated
  (`exercise-page-model.ts:55-57`, `session-view-model.ts:55-58`).
- K3. Dead copies of the maths: `findBestEstimatedOneRepMaxSet`,
  `estimateExerciseOneRepMax`, `computeExerciseVolume` and
  `computeMaxRepsByWeight` (`exercise-calculations/index.ts:122-180`) are used
  only by tests. `computeMuscleSetVolume` and
  `computePerSideMuscleSetVolume` (`muscle-analytics.ts:125-139`) are not on
  any production path. They skip blank→0, performance status and bodyweight.
- K4. No golden test ties the SQL load factor (`group_board_load_factor`) to
  TS `metric-contract.ts:52`. The backend shell tests recompute Wathan inline.

## Decisions (recommended defaults; confirm or change)

| # | Question | Recommendation | Why |
| --- | --- | --- | --- |
| D1 | What do Stats and Today `Sessions` count? | Sessions with ≥1 working set. Today's latest-session card stays a list of every completed session. Today's empty state goes by "no completed session", because it is a list state, not a metric | This is the rule you stated. A session list shows every session; a metric counts only counted sessions |
| D2 | Where do the definitions live? | A new `docs/specs/tech/training-metrics-contract.md` owns all four. §5.11 keeps the product wording only (W-Up effort, what a screen shows) and links to it. `05-data-model.md` keeps the storage and the facts table and links to it | No current doc covers all four. Putting it in `ux-rules` would mix UI rules with the maths, and agent-api and groups need it too |
| D3 | Are zero results records? | **No**, as the docs say. A 0 Weight, 1RM or Volume never sets a record, never acts as a baseline, and never ranks. Group facts store `e1rm_kg = null` at 0 kg, as the contract says | This fixes R5, R7 and R9 together. "0 beats nothing" is the documented intent |
| D4 | Weight record ties | **Decided:** the Weight record is the heaviest entered weight and, at that weight, the most reps — compared as the pair `(weight, reps)`. A set beats the record when it is heavier, or equally heavy with more reps. A full tie keeps the earliest session. `pr_weight`, the holder and the exercise page all use this one comparison | Flag and holder can no longer disagree (R6); more reps at a top weight is progress the user expects to see |
| D5 | Which record kinds does each view show? | The definitions are shared. Which kinds a view shows is a display rule, written once in a table in the contract. Proposal: the exercise page, session view and completion all flag 1RM, and Weight when the 1RM is not a record, as the exercise page does today. Today's `PRs` count stays 1RM-only. Volume is a whole-session record and is shown only in the records panel | This fixes R2 without adding new UI: the session view gains the Weight fallback |
| D6 | Scope of the comparison | All-time across all gyms by default. The current-gym preference is an explicit **scope parameter** of the one definition, applied the same way on every screen that offers the filter (today only the exercise page). Per-block evaluation is removed: one winner per session × exercise (R4) | This keeps the documented "current-gym filter scopes both" behaviour while removing the hidden differences |
| D7 | Personal vs group clock | Leave it. Groups order by session start (`achieved_at_ms`); personal history orders by `completed_at`. Document it in the contract as a deliberate group rule | Changing it would re-rank stored group results for no user-visible gain |
| D8 | Display precision | One `format.ts`: Weight 1 dp (trailing `.0` trimmed), 1RM 1 dp, Volume whole kg, everywhere including Stats and groups. The history sheet keeps whole numbers only if you want that (ux-rules:631 asks for it today) | This is the user-visible part of "consistent calculations". Exceptions should be deliberate, and listed in the contract |
| D9 | The agent-api revision string | Bump `metric_revision` to `working_sets_v2` in the PR that changes zero and tie handling (D3/D4) | API clients need to see that the meaning changed |

## Delivery: 5 PRs

PR 1 is independent. PRs 2 → 3 → 4 run in order. Each PR ships its section of
the contract and replaces the restatements it touches with links.

### PR 1: group board fixes (R7, R8, R9, C3, C6)

1. **Reproduce first.** Add a `groups-leaderboards` case: a member whose only
   counting sets on a linked exercise are 0 kg. Expect the board apply to
   succeed with no 1RM entry. Confirm it fails on `main`.
2. `set-facts.ts:102`: set `e1rm_kg` to null when the parsed weight is 0
   (D3). Bump `GROUP_EVAL_RULES_VERSION` to 5, which re-normalizes every fact.
   As a result no fact has `working` null any more.
3. A forward-only migration, in the same style as
   `20261003120000_group_results_working_sets.sql`:
   - contract-1 Weight candidates use the raw `f.weight_kg` (R8);
   - unify the null handling on `f.working` (C6), now that v5 leaves no
     nulls;
   - write no stored results. Boards move at their next apply, attributed as
     `rules`.
4. `groups/session-metrics.ts:83`: `exerciseCount` counts only exercises with
   a working set (C3).
5. `groups-contract.md`: fix §394 (null at 0 kg, drop `M25-T05`), confirm §585
   raw Weight, and point `working` at the contract once it exists. Until then,
   point it at §5.11.
6. K4: add a TS↔SQL load-factor golden vector to `groups-bodyweight.sh`.

Proposed lanes: `fast`, `backend`, `groups-api-live`. Skip `ios-groups-e2e`:
the group UI change is covered by Jest.

### PR 2: one counted-set rule, one counted-session rule (S1–S4, C1, C2, C4, C5, C7)

1. **Parsing has one owner.** Move `parseSetWeight` and `parseSetReps` into
   `exercise-calculations/parse.ts`. `hasValidActualValues` and
   `session-model.ts:124` call them (S2). Add a Jest case each for `1e3`,
   `0x10`, `42.`, `.5` and `-1`.
2. **Remove the second name.** Callers of `isWorkingSessionSetType` and of
   the two-call composition switch to `isWorkingSet`. `isWorkingSetType`
   stays only where a stored flag needs it: the group facts and agent-api
   projection, which are already filtered by performed status (S1).
3. **Add the session rule** to `set-semantics.ts`:
   `isCountedSession(sets)` = `sets.some(isWorkingSet)`, and
   `countedSessionIds(rows)` for the grouped case. Switch the ~10 sites listed
   in C2 to it, including the per-exercise and per-muscle ones.
4. **Fix the metrics:** Stats `sessionCount` and Today `sessions` use
   `countedSessionIds` (C1, D1). Block history filters before the limit (C4).
   The exercise-history chip counts go through the session rule (C5).
5. **Guard test** (`__tests__/metrics-single-source.test.ts`):
   - no `'warm_up'` comparison outside `set-semantics.ts`, `set-types.ts`
     (labels and cycle order), Maestro fixtures, the import scripts and the
     SQL that reads `working`;
   - no Wathan constants outside `exercise-calculations/index.ts`.
6. **Docs:**
   - create `training-metrics-contract.md` §1–§2 and add it to
     `docs/specs/tech/README.md` and the AGENTS.md load-on-demand table
     ("stats / records / metrics");
   - fix `05-data-model.md:430` (S4);
   - turn the restatements listed in S4 and C7 into links;
   - keep the agent-api README's "Working sets only" section for the field
     list only, linking to the rule.

Proposed lanes: `fast`, `frontend-ui` (the Today and Stats flows assert
session counts), and the quality targets.

### PR 3: one record definition (R1–R6, D3–D6, D9)

1. Add `exercise-calculations/records.ts`:
   - `summarizeSessionBests(sets, context)` returns the 1RM holder, the
     top-weight holder and the volume with its completeness, for one session ×
     exercise;
   - `isRecord(value, bar)` handles zero (D3) and strict `>`; `isWeightRecord(set, bar)`
     compares `(weight, reps)` (D4);
   - `compareRecordOrder` is the single order (`completed_at`, then session
     id).
2. Make every session-best site call it:
   - facts derive;
   - the exercise page (per session, not per block; R4);
   - session insights (with the Weight fallback; D5);
   - `deriveLastSession`;
   - `summarizeExerciseLoad`;
   - catalog stats;
   - agent-api `index.ts:914-928`.

   Delete the session-insights replay fold, which only tests used.
3. **All-time folds:** `pickBests` and `loadEarlierBestE1rmByDefinition` stay
   as SQL over the facts table. Add a Jest property test that runs random
   histories through both and through `isRecord`, and requires the same
   holder and flags.
4. Bump `EXERCISE_SESSION_FACTS_RULES_VERSION` to 4, so devices rebuild their
   facts. Bump the agent-api `metric_revision` (D9).
5. **Gym scope:** both screens call one `recordBaseline({ scope })`. The
   session view passes `all` (D6).
6. **Docs:** contract §3, with a definitions table plus a "which view shows
   which kind" table (D5). Turn the record restatements in `ux-rules.md`
   (111-113, 236, 802-818), `design-language.md:289-298` and `05-data-model.md`
   (133-176, now storage only) into links.

Proposed lanes: `fast`, `backend` (the agent-api contract), `frontend-ui` (the
exercise page and session view record highlight), and the quality targets.

### PR 3b: Weight records on the session view and completion (D5 display)

PR 3 makes the record set one definition (`pickSessionRecordSet`) and gives the
session view and completion the full baseline (`loadEarlierBestsByDefinition`),
but they still show 1RM records only. 3b shows the Weight fallback there, as
the exercise page does: `weightRecord` on `SessionViewSetRow` and
`set-summary-row.tsx`, a kind on `ExercisePersonalRecord`, the card band and
`PersonalRecordCard` / share-sheet copy, and the contract §3 screen table.
It needs a pinned design target and screenshots (`ai-design-policy.md`).
Lanes: `fast`, `frontend-ui`.

### PR 4: calculations and display (K1–K3, D8, the remaining doc sweep)

1. Make the top-weight rule (from `records.ts`) and the contribution range
   check (`bodyweight-contribution.ts`) the only copies (K1).
2. Add `exercise-calculations/format.ts` for Weight, 1RM and Volume (D8). Move
   every formatter to it. Look for them with
   `rg "toFixed|Math.round" app components src`.
3. Delete the dead helpers listed in K3, along with their test-only callers or
   tests rewritten against the live helpers.
4. **Docs:**
   - contract §4 takes the formulas, parsing, blank→0 and display precision;
   - `bodyweight-load-contract.md` keeps the policy and links to §4;
   - remove the remaining restatements, including the blank→0 rule (7 copies),
     raw top weight (8 copies) and muscle volume (`05:446-457`);
   - delete this plan.

Proposed lanes: `fast` and `frontend-ui`; display precision changes the
screens. Refresh any design-target screenshots per `ai-design-policy.md`. Also
run the quality targets.

## Risks

- **Rules-version bumps** rebuild device facts (PR 3) and re-normalize group
  facts (PR 1). Both are designed paths, but measure the rebuild on the
  dev-rich import fixture before the PR.
- **Today and Stats numbers drop for users with warm-up-only sessions** (D1).
  That is the intended fix, but mention it in the PR body.
- **Group board moves** after PR 1 are silent (`rules`). A stored record that
  was 0 kg or converted Weight stands, as in the working-sets migration.
- **The guard test's allowlist** must stay short. Each entry gets a comment
  explaining why.

## Non-goals

- Changing any formula (Wathan, load model, contribution policy).
- New record kinds, a new UI for volume records, or streaks.
- Re-ranking stored group results retroactively.
