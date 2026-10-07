# M33-T01-Preflight_once_per_gate — baseline preflight once per gate

- Status: `planned`
- Depends on: none
- Milestone: `docs/plans/milestones/M33-test-gate-principles.md`
- Areas: backend (test infra); UI impact: no

## Objective

`supabase/scripts/ensure-local-runtime-baseline.sh` runs once per lane. Warm,
it measured ~5s and the backend gate pays it 11 times (~55s), re-applying
migrations, re-seeding and re-provisioning auth fixtures that are already
there. Make a gate pay it once while keeping every lane runnable on its own —
and without letting a wrecked baseline pass as valid.

## Scope

- In: the preflight script, whatever gate-scoped signal `boga` needs to pass
  it, and the invalidation path.
- Out: merging lanes to share a preflight (it would delete `./boga test <lane>`
  affordances documented in `RUNBOOK.md`, specs `02`/`06` and
  `supabase/README.md`); the preflight's individual phase costs are not the
  target, its repetition is.

## Decided

- D3: report measured before/after per lane from `./boga timings`.
- D4 governs this card. A fast path that could hide a broken baseline is
  rejected regardless of what it saves.
- Running one lane by name must still ensure the baseline with no gate present.

## Open — resolve with the user at session start

1. **Invalidation.** A database reset must invalidate the signal. Resets happen
   in `./boga db reset`, in `supabase/tests/groups-competitions.sh`, in
   `supabase/scripts/with-local-group-competitions.sh`, and *inside*
   `apps/mobile/scripts/check-sync-schema-drift.ts` (it resets before
   introspecting, which is why `sync-drift` and the drift body cost ~38s each).
   Agree whether the reset path clears the signal, or the preflight re-verifies
   cheaply every time and only skips the expensive repairs.
2. **What stays on the fast path.** Of the measured phases — status+reach 0.9s,
   function-routes 0.1s, db-push 0.8s, group-eval-configure 0.2s, smoke-seed
   0.8s, auth-provision 1.1s, smoke-seed again 0.8s — agree which are the
   cheap positive check and which are the repairs to skip.
3. Whether the second `smoke-seed` (the post-condition on auth provisioning)
   stays. It is 0.8s × 11 and verifies something real.

## Deliverables and acceptance

1. A backend gate run paying the full preflight once; later lanes pay only the
   cheap check. Measured before/after in the PR.
2. `./boga test <lane>` for any backend lane still green from a cold start.
3. A deliberate negative proof: wreck the baseline mid-gate (e.g. a reset
   between lanes) and show the next lane repairs it or fails loudly — never
   passes on stale state.
4. Jest or meta-test coverage for the signal's lifecycle if it lands in a
   script `scripts/tests/**` can reach.

## Specs to update

- `docs/specs/06-testing-strategy.md` — "Local Supabase baseline contract", if
  the contract's guarantees change.
- `docs/specs/02-quality-and-test-gates.md` — only if lane composition changes
  (note: 2499/2500 words, trim first).

## Gates

`./boga test for` is authoritative. Expect `fast` + `backend` (the measurement),
plus `groups-protocol4` because it resets the stack and is the sharpest test of
invalidation.
