# Co-primary muscles and shared muscle allocation

Status: planned. Source: [#1029](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/1029).

Implement support for multiple Primary muscles per exercise in one PR. Follow
`AGENTS.md` and the ponytail skill; reuse existing UI and analytics. Delete this
task when its implementation ships.

## Requirements

- Make Primary selection multi-select using the existing Secondary selection UX.
  Require at least one Primary, prevent overlap with Secondary, and preserve
  mappings through editing, reopening, duplication and sharing.
- Allocate two independent pools, using existing per-side/total-load semantics.
  With muscle-volume base `V`, eligible working sets `S`, and mapping counts
  `Np` (Primary) and `Ns` (Secondary):
  - Each Primary receives `V / Np` volume and `S / Np` working sets.
  - Each Secondary receives `0.5V / Ns` volume and `0.5S / Ns` working sets;
    no Secondary pool when `Ns = 0`.
- Preserve **Count secondary sets**: OFF excludes Secondary volume and sets
  without changing Primary shares. No new setting.
- Apply consistently across muscle analytics, weekly targets, recovery and
  training-status reporting. Update exercise API/MCP create and update validation
  to allow multiple Primaries.
- Broad grouping must preserve allocated shares without duplication.
  Hidden/untracked mappings must not redistribute their shares.
- Recalculate historical muscle analytics without rewriting exercise logs. Keep
  exercise Volume, physical set counts, RM estimates and personal records unchanged.
- Prefer the existing schema; add a migration only if inspection proves necessary.
  Report real blockers or conflicting requirements instead of changing the
  allocation model.

## Done when

- Automated tests cover single/multiple Primaries with zero/multiple Secondaries,
  Secondary ON/OFF, Broad/Detailed grouping, hidden mappings, editor
  save/reopen/duplicate/share, API/MCP create/update and historical compatibility.
- Fractional counts such as `1.5` and `1/3` survive aggregation without premature
  rounding.
- Use **Machine Dips** as the main acceptance example: it already has Chest and
  Triceps as Primary. Do not modify the user's live database.
- A human validates UI changes in the graphical app **before the final UI test
  suite runs**.
- Update affected product facts/contracts and pass the repository's required gates.

Choose the smallest complete implementation after inspecting current code.
