# M42-T04 — Set rehab tagging and metric protection

- Status: `planned`
- Depends on: [M42-T01](M42-T01-Injury_contract_and_sync_schema.md)
- Milestone: [M42](../milestones/M42-injury-and-discomfort-tracking.md)
- Areas: mobile data, exercise calculations, specs; UI impact: yes

## Objective and scope

Introduce `'rehab'` set typing and optional set-level discomfort notations,
updating calculation engines and specs so that rehab sets and sets performed
under discomfort never trigger false negative PR trends or corrupt working
volume analytics. Follow milestone D4. This task does not touch group
competition scoring or external API endpoints.

## Baseline to verify

Load `docs/specs/tech/training-metrics-contract.md` and `docs/product/1rm.md`,
`set.md`, `muscle.md`. Inspect `apps/mobile/src/exercise-calculations/load-metrics.ts`,
`rm-curve.ts`, and `apps/mobile/src/data/muscle-analytics.ts`. Inspect set row
editing in `apps/mobile/components/exercise-page/exercise-set-row-item.tsx`.

## Open — resolve before coding

- Schema extension: add `'rehab'` to `exercise_sets.set_type` enum (alongside
  `'normal'`, `'warmup'`, `'drop'`, `'failure'`).
- Optional set discomfort rating: lightweight 0–10 pain rating or discomfort tag
  on `exercise_sets`.
- Calculation rules:
  - 1RM curves: rehab sets are completely excluded from 1RM estimation curves
    and PR records.
  - Muscle volume targets: rehab sets do not count toward primary working set
    targets (following the same principle as warm-up sets), but can be
    inspected under a dedicated rehab filter.
- Update `training-metrics-contract.md` to document the formal exclusion rules.

## Deliverables and acceptance

1. Mobile SQLite schema and recorder UI support selecting `'rehab'` set type.
2. Calculation kernel updates in `apps/mobile/src/exercise-calculations/`:
   rehab sets do not qualify for 1RM predictions or personal records.
3. Muscle analytics update in `apps/mobile/src/data/muscle-analytics.ts`
   segregating rehab sets from direct working sets.
4. Comprehensive test vectors in `load-metrics-vectors.json` and unit tests
   verifying that rehab sets never trigger PR regressions.
5. Update `docs/specs/tech/training-metrics-contract.md` with durable rules.

## Gates

Expected from `./boga test for`:
`fast` | `backend`
