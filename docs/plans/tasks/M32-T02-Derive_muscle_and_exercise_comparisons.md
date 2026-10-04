# M32-T02 — Derive muscle and exercise comparisons

- Status: `planned`
- Depends on: `M32-T01`; PR #497 landed (or equivalent confirmed on main)
- Milestone: `docs/plans/milestones/M32-progress-tables-and-individual-history.md`
- Areas: frontend data; UI impact: no

## Objective

Expose the read model needed by the muscle table and selected muscle's exercise
contribution table. Derive both periods from one consistent local-data snapshot
and the existing comparison bounds so row values and totals cannot disagree.

## Scope

- In: small pure aggregations/read adapters, stable IDs, coverage and parity tests.
- Out: landing UI, heatmap redesign, preference storage, schema/sync/backend work,
  changing set eligibility or arithmetic, speculative materialized caches.

## Decided

Milestone D2, D3, D6 and D7 govern. Reuse `src/data/stats.ts`,
`src/data/muscle-analytics.ts`, canonical calculation helpers and the merged
period API. Place persistence reads in `src/data`; pure projection code imports
the allowed lower layers. Do not copy the working-set predicate.

## Deliverables and acceptance

1. Individual muscle records expose current/previous Working sets and Volume
   and their existing comparison semantics in stable taxonomy order, retaining
   zero-current and all-zero taxonomy entries.
2. For a selected muscle, aggregate the union of exercises contributing in
   either period by definition ID, across every block/session. Each physical
   set counts once for that muscle; role affects Volume, not the set count.
   Preserve legitimate zero and incomplete Volume coverage as distinct states.
3. Sum of contribution rows equals the selected muscle's value in each period;
   absolute set deltas also reconcile. Volume percentages are computed from
   each row's own baseline and are not summed. Handle previous-zero/new Volume
   and incomplete baselines without fake percentages or zero substitution.
4. Primary/secondary metadata may explain involvement but never fractions of
   a working set. No global total sums overlapping muscle counts. Unknown or
   unlinked rows follow the existing analytics contract, with explicit coverage
   where it is already required; do not invent name-based identity joins.
5. Jest uses pure vectors plus real migrated SQLite repository tests: warm-ups,
   planned/unperformed sets, duplicate source mappings, repeated blocks, zero
   load, previous-only exercise, empty muscle, mapping reinterpretation,
   bodyweight/per-side Volume and date-boundary membership. Refresh after edits
   must produce the same totals as the existing muscle summary oracle.

## Specs to update

- `docs/specs/tech/training-metrics-contract.md`: clarify Progress physical
  muscle-set counts versus the existing role-weighted session summary if needed;
  do not change the underlying counting rules.
- `docs/specs/09-project-structure.md`: only if a new owned projection boundary
  is warranted. Prefer existing ownership over a new abstraction.

## Gates

Read the test directory README before editing tests. `fast` is mandatory;
pure/local read-model work normally needs no extra backend or simulator lane.
Query `./boga test for` and agree any lowering before running slow lanes.
Finish with `jest-coverage`, `complexity`, `dependencies` and list their evidence
in the PR. Delete this card and mark T02 completed in that PR.
