# Workout data audit and exploratory curve comparisons

## Status and scope

Research deliverable for T03, on the experimental branch stack from reviewed T02. The owner authorised synthetic curves and read-only remote BOGA_DEV history, then selected one account and replaced Barbell Deadlift with Zercher Squat. The second exercise is Dumbbell Bench Presses, which supplies a longer history and a per-side load case. Account email, owner UUID, gym identities and raw private histories stay out of this report and commits.

This delivers data/provenance auditing and descriptive comparisons. Effort provenance for the authorised account still needs operator clarification; no calibrated RIR accuracy, strength diagnosis, structural break or production feature is approved. T04 retains the empirical reliability and final analytical/product review gate.

## Inventory

| Input | Counts and coverage | Provenance and use |
| --- | --- | --- |
| Checked-in rich-history package | 221 sessions, 2,910 sets, 168 exercise/gym cohorts; December 2024–June 2026; 1,304 sets with canonical known RIR | GymBook-labelled source; all 2,910 labels match the original rank-based enrichment. Original export is not authenticated. Treat as imported/enriched demonstration data, not verified measured effort. |
| Shared weekly wave | 24 prior sets in 8 sessions, 6 qualifying priors; 72 sets / 24 sessions in each of plateau, stable and gradual controls | Synthetic/provisional throughout. Input unchanged; freezing belongs to T04. |
| Authorised remote pair | 181rows: Zercher45, Dumbbell Bench136; 77qualifying analytical points;48 nonworking/nonperformed, 40 missing-effort, 16 deleted-graph exclusions | One owner; current metadata; separate same-gym cohorts. Snapshot and full outputs are local/private. |
| Shared Jest/Maestro history generator | Base 11 sessions, 12 blocks, 16 sets; actual reps 2/3/4/5/6/8/10; RIR 0/1/2, warm-up and missing effort | Synthetic, with dates relative to runtime; squat/bench/unmapped exercise cases. Additional completion variants are separate generated cases. Not empirical observations. |
| Existing shared vectors | 11 load-calculation vectors and 18 exercise-core cases | Rule/edge-case oracles, not workout histories. Existing tests already execute them; do not repeat their formula checks in each research task. |

Rich-history efforts are warm-up: 886; missing: 720; RIR 2: 620; RIR 1: 346; RIR 0: 338. Every preserved source effort is `default`; none carries a canonical source RIR. Git commit 25f0f103's enrichment assigned warm-up, missing, RIR 2, RIR 1 and then RIR 0 by within-block rank. The current enricher starts at a different RIR; applying it now would alter this history. This audit reads the stored package without rerunning enrichment or importing it anywhere.

Relevant existing generators/tests are `apps/mobile/src/maestro/exercise-block-history-fixture.ts`, `apps/mobile/__tests__/exercise-block-history.test.ts`, `apps/mobile/__tests__/exercise-history-repository.test.ts`, `apps/mobile/src/exercise-calculations/load-metrics-vectors.json` and `apps/mobile/src/exercise-core/exercise-core-vectors.json`. The bodyweight fixture is an active logging/reading-management scenario rather than a completed longitudinal history.

## Extraction and comparison contract

Use [[1rm.curve-population]], [[1rm.curve-effort]], [[1rm.curve-reference]] and [[1rm.curve-load]]. The test-only helper calls the adopted calculation kernel at actual reps, then derives analytical RM at equivalent reps. No formula or loading rule is copied. Missing and unknown effort stay distinct; planned/deleted/active/unlinked/invalid rows do not become observations. Canonical high RIR and zero-load observations survive their existing rules. Raw actual/planned values and IDs remain in the private source snapshot; duplicate extracted owner/set identities fail rather than double-count.

Remote SQL joins every graph edge with the same authorised owner. It reads only the two selected definitions and necessary workout/current-load fields, with no writes, gym coordinates, other owners or private readings. Both selected definitions have zero bodyweight contribution; the kernel still applies the bench's per-side factor once. Exercise metadata and the synced bodyweight preference come from the current snapshot. Device-local effort preferences are unavailable remotely: this research explicitly uses personal defaults and never claims to reproduce an unknown device choice.

For the rich package, reconstruct the current dev seeder's metadata precedence using the actual seed definitions, explicit create-new decisions and the seeder's fallback for nonseed catalog entries. This is a reproducible dev-seed reconstruction, not recovered historical equipment metadata. Do not halve its already-normalised imported Weight again.

Calendar is declared Europe/London, with the existing History bound helper and 52-week look-back. Each exercise/gym cohort uses a prespecified chronological split at two thirds of its distinct qualifying session start times. The reference uses strictly prior completions, excludes tied/evaluated/future sessions and remains fixed. This retrospective comparison holds later sets out of the reference; it is not untouched prospective model-selection evidence. Shorter 12/26-week windows and exact RIR strata keep that same cutoff; missing support is reported without broadening gym/effort/window criteria.

Signed residuals use calculated total-load kg; chart coordinates divide both point and curve by the entry factor. Percentage distributions over sets are descriptive. Regressions use one session-median response per workout; repeated blocks are retained but never counted as extra independent sessions.

## Remote provenance and results

116 of 181 rows match the rich package's exercise, start time, block/set order and logged Weight/reps/effort/status. No package set IDs match. These overlapping coordinates are evidence of shared/enriched history to investigate, not authenticated import identity. The 65 unmatched rows are not independently verified RIR either. The native/unmatched-only sensitivity supplies no supported six-prior-session reference. Operator clarification distinguishes automatically assigned labels from effort actually recorded during workouts; targets and inherited planned labels cannot establish that distinction.

| Largest same-gym cohort | Prior support at the declared cutoff | Later comparison |
| --- | --- | --- |
| Zercher Squat | 3 qualifying prior sessions | 2 evaluation sessions; points retained, reference/residual absent. Other gym cohorts also lack support. |
| Dumbbell Bench Presses | 9 qualifying prior sessions; latest 6 selected | 14 sets across 7 evaluation sessions. Median set percentage residual −11.75%; median of session medians −15.55%. |

The negative bench residual compares later observations with a median of earlier session bests. Selection, rep/effort composition, time, execution and provenance can all contribute; it does not establish lost strength or an inaccurate RM formula. Its reference is 60.6360 total-RM kg, or 30.3180 in the exercise's entry units. Shorter 12/26-week look-backs supply1/3 qualifying priors respectively and therefore no reference. Every exact RIR 0/1/2stratum supplies at most5priors, so there is no independently supported stratum-specific curve.

Observation-only RIR −1/+1 changes the bench median set residual to −13.78%/−9.78%. Coupled +1 also changes prior eligibility and leaves 5 qualifying sessions: the reference disappears. These are deterministic sensitivity scenarios, not an estimate of RIR sigma or confidence intervals. The prior-mean alternative gives −14.42%; it is labelled a research comparison and does not replace the approved median rule. Only 1 of 6 remote exercise/gym cohorts and 7 of 168 rich-demo cohorts support a reference under this split.

## Synthetic curves and weekly progress

Every prefix is checked against the independently truncated source: three observed sets per week, fixed original prior selection, no later sets or fits entering earlier results. Constant and linear regressions are recomputed from each completed prefix's session medians. Convert the fitted percentage back to an analytical RM level and reuse the adopted curve shape. A first-session regression has insufficient residual degrees of freedom; no fitted curve is fabricated.

The figures show curve snapshots through weeks 4/8/12/16/20/24 and the full prefix-level trajectory. A linear fit is descriptive and may smooth a plateau or overstate a current level; no model winner or confidence band is claimed. Stable controls finish at 99 kg, while the reference remains 100 because prior bests and session medians differ. The smooth control finishes at 122.76 kg for its session-median response. It remains a method control, not an expected training trajectory. The primary plateau story's final linear summary is 109.4261 kg; it is not an independently known physiological truth.

Evaluation-only composition sensitivities retain the original reference. Excluding reset leaves 18 sessions; restricting equivalent reps to 1–10 also leaves 18 but changes within-session selection. The plateau mean session residual changes from 4.0161% to 3.9215% and 3.7768% respectively. Same-phase summaries are also recorded. Reset's specified tempo/pause is programme intent, not verified performed technique; no tempo effect is simulated or empirically established here. These experiments introduce no production phase filter.

## Reproduction and review

Run the TypeScript research script with the worktree's installed `tsx` and mobile tsconfig. Its only optional input is an already authorised private snapshot; its boolean marker is provenance documentation, not an access-control mechanism. The script itself opens no database/network connection.

```bash
TZ=Europe/London apps/mobile/node_modules/.bin/tsx --tsconfig apps/mobile/tsconfig.json docs/plans/research/M36-T03-workout-curve-analysis.ts --remote-input=apps/mobile/artifacts/research/m36-t03/remote-private-snapshot.json > apps/mobile/artifacts/research/m36-t03/results.json
python3 docs/plans/research/M36-T03-curve-figures.py apps/mobile/artifacts/research/m36-t03/results.json apps/mobile/artifacts/research/m36-t03
```

Plotting requires Matplotlib; this run used 3.9.4 in a temporary environment outside the repository. No app dependency was added. Without the remote argument, the same source runs synthetic and enriched-package checks only. Full outputs/private query/snapshot/figures and gate logs are gitignored local PR evidence; raw private input must not be uploaded. Input hashes are reported by the script; the unchanged wave hash is 172dae999afb8e2a0a3dcf34ced8c474f17eca76c04a68aa17edc753e144ae26.

Focused Jest covers extraction, duplicate identities, owner/gym isolation, cutoff/support, unchanged logged RM and bodyweight/per-side loading. The agreed fast, coverage, complexity and dependency gates pass; detailed results belong in the PR. Numerical assertions and scientific-figure rendering pass. The independent code/product review and visual inspection accompany the draft.

## Decisions remaining

Confirm imported versus recorded effort provenance and accept descriptive-only claims where effort is unverified. T04 must test both configurable assumed RIR sigma and joint RM/sigma candidates with independent known truths, nuisance/dependence sensitivities and measured reliability. No dispersion in these mixed histories independently calibrates sigma. The approved first-release reference rule remains unchanged; sparse support is a finding, not permission to loosen it. Additional weekly fitted-curve UI, statistical claims and design remain unapproved.
