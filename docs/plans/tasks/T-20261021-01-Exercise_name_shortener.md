# T-20261021-01 — Exercise name shortener

- Status: `in_progress`
- Depends on: none
- Milestone: none
- Areas: frontend; UI impact: no
- Issue: https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/820

## Objective

Provide a reusable pure TypeScript tool that abbreviates exercise names on demand.
Deliver the helper and its tests only; no screen consumes it in this task.

## Scope

- In: a named `shortenExerciseName(name: string): string` export in
  `apps/mobile/src/exercise-catalog/shorten-exercise-name.ts`, focused Jest tests
  in `apps/mobile/__tests__/exercise-name-shortener.test.ts`, concise API documentation.
- Out: UI integration, persistence, seed renames, search/index changes, backend
  changes, new dependencies, configuration, maximum-length truncation, translations.

## Decided

The operator approved the audited vocabulary with two corrections: keep the
individual word Machine in full; use DL for Deadlift and RDL for Romanian Deadlift.
The previously agreed full equipment phrases still have their own abbreviations.

| Input (case-insensitive) | Output |
| --- | --- |
| One Hand / Single Hand | 1H |
| One Arm / Single Arm | 1A |
| One Leg / Single Leg | 1L |
| Kettlebell / Kettlebells | KB / KBs |
| Dumbbell / Dumbbells | DB / DBs |
| Barbell | BRB |
| Smith Machine | S/M |
| Cable Machine / Cable | C/M |
| Overhead | O/H |
| Supported | Supp. |
| Alternating | Alt. |
| Extension / Extensions | Ext. |
| Rotation / Rotations | Rot. |
| Close Grip | CG |
| Wide Grip | WG |
| Romanian Deadlift / Romanian Deadlifts | RDL / RDLs |
| Deadlift / Deadlifts | DL / DLs |
| Assisted | Asst. |

- Match complete words and phrases, allowing spaces or hyphens between phrase
  words. Replace every occurrence. Match the longer phrases before component words.
- Preserve the case, whitespace and punctuation outside matched spans. Empty,
  whitespace-only and unsupported input passes through exactly unchanged.
- Existing abbreviations remain unchanged; applying the function twice equals once.
- Machine alone stays Machine, including Seated Machine Row. Keep descriptive
  words such as Standing, Incline, Lateral, Hammer and Triceps in full.
- Output is a derived label, never an identity or replacement for saved names.
- The audit's 30-character threshold was a review aid, not an output constraint.

## Open

None. Implement the agreed contract without adding aliases.

## Deliverables and acceptance

1. Small, import-free helper with one named export and a private replacement table.
2. Pure Jest tests for all mappings, singular/plural outputs, mixed case, repeated
   matches, phrase precedence, spaces/hyphens, punctuation, empty/unknown input,
   whole-word protection (including surrounding non-English text), preservation,
   Machine remaining in full, existing abbreviations and idempotence.
3. Representative combined vectors: Barbell Deadlifts -> BRB DLs; Dumbbell
   Romanian Deadlifts -> DB RDLs; Single Leg Romanian Deadlifts -> 1L RDLs;
   Supported Dumbbell Reverse Fly -> Supp. DB Reverse Fly; Alternating Incline
   Dumbbell Twist Curls -> Alt. Incline DB Twist Curls; Standing High Cable
   One-Arm Triceps Extensions -> Standing High C/M 1A Triceps Ext.
4. No production caller, data write, dependency, schema or UI change.
5. Independent code and product review; green agreed gates before opening the PR.
6. Delete this card in the implementation commit; its planning commit preserves it.

## Specs to update

None expected: an additive helper within an existing folder. Keep the API contract
in its JSDoc and tests; update an owning spec only if implementation reveals a need.

## Gates

The operator requested implementation, review, tests and a PR after the proposed
lane set: `./boga test fast`, `./boga test jest-coverage`,
`./boga test complexity`, `./boga test dependencies`.
Run `./boga test for` on the final diff. Expected default: fast only. No Maestro or
additional backend lane: this is a pure helper with no runtime integration.

Implementation agent runs fast; the coordinating agent owns the three quality
lanes, final reviews, PR, stack shutdown and subsequent worktree lifecycle.
