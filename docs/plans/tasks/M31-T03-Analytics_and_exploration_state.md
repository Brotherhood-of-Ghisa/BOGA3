# M31-T03 — Derive four-week analytics, targets and exploration state

- Status: `planned`
- Depends on: `M31-T02-Preferences_and_target_storage`
- Milestone: `docs/plans/milestones/M31-progress-exploration-and-targets.md`
- Areas: frontend domain / data; UI impact: no

## Objective

Supply the Progress UI with aligned daily/weekly series, weekly target attainment
and a predictable selection model. Apply the calendar and effort contract from
T01 while preserving all formulas outside the explicitly accepted changes.

## Scope and decided requirements

Milestone D1–D4 apply. Feature state imports the data layer; `src/data` must not
import a feature view model or UI. Reuse existing calculation/calendar helpers
and facts where sufficient; batch source reads instead of replaying all history
for each selected entity. Do not introduce a second metric kernel.

## Open — resolve at session start

Recheck which current readers/facts retain the effort and muscle information
needed by the accepted filter. Choose simple state and query boundaries; record
any required facts rules-version/invalidation changes before implementation.

## Deliverables and acceptance

1. Four-week bounds and previous-period comparison implement the accepted local
   calendar/date-attribution rules, including DST and partial weeks. Changing
   granularity cannot silently change the underlying time range.
2. Compatible muscle/family/exercise series use the same buckets and units.
   Empty buckets, unavailable values and incomplete bodyweight coverage remain
   distinguishable from measured zero; family counts union physical source sets.
3. Target evaluation uses weekly quotas and the accepted effort rule, with
   defined unset/zero targets and target-edit history. No unrelated volume,
   1RM, top-weight or group rule changes occur without T01's explicit decision.
4. State transitions cover entity switching, comparison add/remove, metric
   compatibility, range/granularity changes, invalid/deleted selections, focused
   bucket retention, navigation and stale async requests according to the UX
   contract. No separate muscle/exercise state can drift accidentally.
5. Deterministic Jest fixtures prove calendar boundaries, classification and
   comparison/target counts, historical parity outside approved changes, and
   the state transitions above. Recompute/invalidate after relevant edits.
6. Delete this card and mark T03 completed in the milestone in this PR.

## Touchpoints and specs

Inspect `src/data/stats.ts`, `muscle-analytics.ts`, `exercise-history.ts`,
`exercise-catalog-stats.ts`, `exercise-session-facts*.ts`, calculation helpers
and `src/utils/local-calendar.ts`. Put UI-free feature state outside `app/`;
update `09-project-structure.md` if a new directory becomes canonical. Update
the owning data, architecture and UI metric contracts for shipped behavior.

## Gates

Read `apps/mobile/__tests__/README.md`. Follow T01's staging agreement; add/update
Jest and pass `fast` and quality targets before the PR. Propose extra lanes if
the actual diff reaches a server-shared calculation or schema/sync boundary.
Performance claims require measurements; do not estimate gate duration.
