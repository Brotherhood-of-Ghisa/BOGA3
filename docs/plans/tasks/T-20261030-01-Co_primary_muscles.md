# Co-primary muscles and shared muscle allocation

Status: implementation in progress; human graphical validation pending. Source: [#1029](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/1029).

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

## UX Contract and design target (build input)

Target: reuse the current editor's Secondary muscle multiselect for Primary,
with the same Sheet, checkboxes, tokens and dismissal. No visual restyle.

- Edit mappings: open an exercise, open Primary muscles, toggle multiple
  muscles, dismiss and Save. Reopening and duplication retain every role;
  sharing carries all mappings. Secondary cannot select a Primary.
- Empty Primary: deselect all visible Primaries and Save. Show the existing
  field error unless a preserved hidden Primary still satisfies the rule.
- Broad/hidden mappings: opening and saving keeps underlying entries and hidden
  roles. Editing a reported muscle changes its entries, following the existing
  reporting model.

Product changes: **muscle.set-count**, **muscle.secondary-filter** and
**muscle.report-groups**, and **muscle.no-breakdown**. Primary and Secondary pools split before reporting.
Recovery keeps its compact floor above one; below one, non-half allocations
show two significant decimal digits instead of incorrectly showing a half.
Human GUI validation precedes the final UI gate; screenshots stay in artifacts.

### Execution checkpoint

- Worktree: `codex/co-primary-muscles`, isolated slot 6.
- Independent code/security review: clean after fractional-target and hidden-anchor fixes.
- Product review: fact changes to the four IDs highlighted above; no violations.
- Jest: 397 suites / 6048 tests green; coverage 87.89% branches, 95.20% lines.
- Complexity, dependency direction, documentation and MCP unit checks green.
- Backend validation in progress; graphical preview, human acceptance and the final
  `ios-data-smoke` / `ios-session-view` lanes await Xcode system-component setup.
- Lane agreement: independent reviewer accepts fast + backend + the three quality
  targets; lower frontend-ui to the two affected iOS lanes after human validation.
- No PR or merge yet. Delete this card when opening the implementation PR.
