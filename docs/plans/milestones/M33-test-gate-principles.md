# M33 — Test-gate principles and the cleanups that follow

- Status: `in_progress`
- Created: 2026-10-07, planning baseline `2d4f0e7c` on `origin/main`

## Objective

Codify the lane-design rules that came out of profiling `boga test backend`
(measured 10.7m → 4.9m in #591), then apply them to the three cost centres
that profiling identified. Each card must report measured before/after from
`./boga timings`, never an estimate.

## Scope

- In: the lane-design rules in `docs/specs/06-testing-strategy.md` (shipped by
  this plan's PR); once-per-gate baseline preflight; the group bodies' drain
  setup cost; backend assertions that belong in a cheaper layer.
- Out: renaming `sync-infra` and `groups-leaderboards` (D6); cost-budget
  tooling (D7). Both discussed and deliberately deferred by the operator.

## Agreed design direction

### D1. The rules live in spec `06`, not in a plan

Shipped with this plan's PR as *Lane design rules*. Cards cite the spec, never
this milestone.

### D2. The cheapest-layer rule already existed

Spec `06`'s *Test layers* section already says "pick the cheapest layer that
can prove the claim". It was not restated (doc rule 5, one place per fact).
This milestone is therefore **enforcement of an existing rule**, not a new
policy — which is also why the drift went unnoticed.

### D3. Measured, not estimated

Every card states before/after from the per-run records `./boga test` writes.
A card that cannot measure its claim has not finished.

### D4. Fail loud, never silently cheaper

A cleanup that could let a stale or broken baseline pass as valid is rejected,
however fast. Any skip needs a cheap positive check that fails loudly when the
assumption breaks.

### D5. Coverage is moved, never dropped

Assertions may change layer or lane. Losing one needs the operator's
agreement, recorded in the shipping PR's Deviations section.

### D6. No renames in this milestone

`sync-infra` tests no infrastructure and `groups-leaderboards` tests the
evaluator rather than the boards, so both violate rule 1. Renaming splits each
lane's 90-day timing history, so it is a separate decision the operator has
deferred.

### D7. No cost-budget tooling in this milestone

Rule 5 is enforced by review here, not by a gate.

## Task breakdown

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| `M33-T01-Preflight_once_per_gate` | Run the shared baseline preflight once per gate instead of once per lane (~55s measured), with a fail-loud backstop | none | completed |
| `M33-T02-Cut_drain_setup_cost` | Measure the setup/assertion split of the group bodies' 213 `group-eval` drains, then cut the setup share | none | planned |
| `M33-T03-Move_assertions_to_cheaper_layers` | Audit the backend bodies for assertions a Jest layer can hold, and move them | T02 | planned |

T01 and T02 touch different files and can run in parallel. T03 follows T02
because both edit the group bodies.

## Risks / dependencies

- **T01 is the risky one.** It makes the preflight stateful; D4 governs it. The
  destructive bodies (`groups-protocol4`, the drift bodies) each reset the
  database, so the stamp must be invalidated by a reset, not by elapsed time.
- The generated lane matrix in spec `02` lags: it keeps a committed figure
  until the 5-newest-green median moves >20%, so figures settle a few runs
  after each card. Refresh with `./boga docs gen`, don't hand-edit.
- Spec `02` sits at 2499/2500 words. A card that adds a lane there must trim
  first.
