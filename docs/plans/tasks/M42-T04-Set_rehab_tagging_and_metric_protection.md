# M42-T04 — Set rehab effort classification and metric protection

- Status: `planned`
- Depends on: [M42-T01](M42-T01-Injury_contract_and_sync_schema.md)
- Milestone: [M42](../milestones/M42-injury-and-discomfort-tracking.md)
- Areas: mobile data, exercise calculations, specs; UI impact: yes

## Objective and scope

Introduce `'rehab'` effort classification into BoGa's `EFFORT_CHOICES` and
update calculation kernels, effort policy, and training metrics specs so that
rehab sets never trigger false negative PR trends or corrupt working volume
analytics. Follow milestone D4. This task does not touch group competition
scoring or external API endpoints.

## Baseline to verify

Load `docs/specs/tech/training-metrics-contract.md` and `docs/product/1rm.md`,
`set.md`, `muscle.md`. Inspect `apps/mobile/src/exercise-calculations/effort-policy.ts`,
`set-semantics.ts`, `load-metrics.ts`, `rm-curve.ts`, and
`apps/mobile/src/data/muscle-analytics.ts`. Inspect set row editing in
`apps/mobile/components/exercise-page/exercise-set-row-item.tsx`.

## Open — resolve before coding

- Effort choices integration: add `{ id: 'rehab', label: 'Rehab' }` to
  `EFFORT_CHOICES` in `apps/mobile/src/exercise-calculations/effort-policy.ts`.
- Policy defaults: in `DEFAULT_PERSONAL_EFFORT_POLICY` and `SHARED_EFFORT_POLICY`,
  `'rehab'` is excluded from `workingSetEfforts` and `volumeEfforts`
  (`working: no`, `volume: no` in `docs/product/set.md` `set.eligibility`,
  matching `technique` and `cooldown`).
- Zero set-row micro-friction: do not add 0–10 pain sliders to individual set
  rows; selecting the `'rehab'` effort label is the single low-friction action
  during active workout logging. Pain scores are maintained via injury check-ins.
- Calculation rules:
  - 1RM curves: rehab sets are completely excluded from 1RM estimation curves,
    PR records, and top weight calculations.
  - Muscle volume targets: rehab sets do not count toward primary working set
    targets (following the same principle as warm-up sets), but can be
    inspected under a dedicated recovery filter.
- Update `training-metrics-contract.md` and `docs/product/set.md` to document the
  formal exclusion rules.

## Deliverables and acceptance

1. Add `'rehab'` to `EFFORT_CHOICES` in `effort-policy.ts` and set effort picker
   UI in the recorder.
2. Calculation kernel updates in `apps/mobile/src/exercise-calculations/`:
   verify `isWorkingSet`, `isVolumeSet`, and 1RM curve generators treat
   `'rehab'` according to policy.
3. Muscle analytics update in `apps/mobile/src/data/muscle-analytics.ts`
   segregating rehab sets from direct working sets while retaining them for
   recovery tracking.
4. Comprehensive test vectors in `load-metrics-vectors.json` and unit tests
   verifying that rehab sets never trigger PR regressions.
5. Update `docs/specs/tech/training-metrics-contract.md` and `docs/product/set.md`
   with durable rules.

## Gates

Expected from `./boga test for`:
`fast` | `backend`
