# T-20261021-01 — RM curve defaults (#806)

- Status: `planned`
- Depends on: none
- Milestone: none
- Areas: frontend, product docs; UI impact: yes
- Issue: https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/806

## Objective

Open each RM curve with the settings shown in the issue screenshot: All gyms,
the configured History look-back, All known RIR, One curve and Parsimonious.
The operator approved implementing the proposed fixed defaults in this session.

## Scope and decisions

- Change the initial scope, reusing the current three-state gym convention:
  an unset gym means all gyms, `null` means No gym, an ID means that gym.
- History look-back follows the existing account preference, never a fixed
  156 weeks. Manual filters remain local to the mounted chart; a fresh chart
  starts with the approved defaults.
- Preserve route exercise, calculation/eligibility rules, logged data, fitting
  limits, selection, Retry and navigation. No new Settings, persistence, native
  dependency, schema or backend changes.
- Keep the change small. Remove obsolete default-only code if the changed
  initialization leaves it without a production caller; check every caller.

## Design target and UX contract

The issue screenshot is the reference for the initial filter state and existing
layout: https://github.com/user-attachments/assets/8dc5f6e7-329a-46d3-8633-23e072cae92f

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Open/reopen | Exercise History → RM curve | Approved defaults; include every gym and qualifying sets throughout configured History | Empty/deleted exercise keeps the existing empty/unavailable behavior |
| Narrow scope | Choose gym, range or RIR; change curve/model | Points and fit match the chosen scope; History/back remains intact | No matches retains controls; no stale data |
| Recover | Read fails → Retry | Same selected filters and set restored when valid | Broader history retains existing budget failure and shorter-range action |

## Deliverables and acceptance

1. Initialization and owning product fact `1rm.curve-scope` agree. Load the
   product-authoring procedure before editing the fact.
2. Jest over real migrated SQLite proves defaults include qualifying older
   than 12-week sets and multiple gyms including No gym; configured bounds,
   manual filters, reset on fresh chart, error/Retry and existing navigation
   are covered. Update existing assertions without weakening scope checks.
3. Adapt the existing `rm-curve-regimes.yaml` flow to new defaults. Preserve
   its device proofs; no new flow or scenario is authorized or needed.
4. Capture the initial controls in the simulator and compare to the reference.
5. Delete this ephemeral card in the implementation commit; retain its creation
   in Git history. No plan/card references in production code or durable docs.

## Gates and review

The operator authorized the lane proposal in the previous message:
`./boga test fast`, `./boga test ios-rm-curve`, `./boga test jest-coverage`,
`./boga test complexity`, `./boga test dependencies`.
This narrows the frontend-ui default to the existing affected RM curve lane.
The primary agent owns review, gate execution, PR creation and stack shutdown.
The implementation agent returns the diff and any concerns before those steps.
Run product review (including persistent-doc audit after the fact change) and
independent code review before opening the PR. Put evidence in the PR, not here.
