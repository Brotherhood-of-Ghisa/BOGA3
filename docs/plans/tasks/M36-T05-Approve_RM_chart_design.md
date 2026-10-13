# M36-T05-Approve_RM_chart_design — Design and obtain human approval of the RM scatter chart

- Status: `planned`
- Depends on: M36-T04
- Milestone: `docs/plans/milestones/M36-rm-performance-curve-analytics.md`
- Areas: frontend; UI impact: yes

- Workstream: 3 — Graphics and design

## Objective

Design the first-release interactive reps-versus-load scatter view using the validated analytical contract and BoGa’s current design system. Pin a human-approved design target and UX contract before production UI implementation or UI acceptance testing.

## Scope

- In: Chart, filters, point readout, all data states, accessibility and proposed final navigation entry.
- Out: Production code, UI acceptance test execution, breakpoint UI, new design system or altered metric conventions.

## Decided

Milestone D1–D5 govern this task. This is planning only; no design, analytical selection or test-lane proposal is approved by creating the card. One card = one session = one local worktree = one PR under the task protocol. Merge the planning PR before execution.

## Open — resolve with the user at session start

Figma frames versus a repo-native target; entry from selected exercise/history; recency legend, overlap selection, range/effort controls and insufficient-data presentation.

## Deliverables and acceptance

1. Follow `docs/specs/ui/ai-design-policy.md` and spec 08. Reuse `uiRoles`, `uiFonts`, primitives and existing chart/readout/selection conventions; assess `react-native-svg` before proposing another renderer.
2. Design X = repetitions and Y = the approved load coordinate, qualifying-set scatter and estimated reference overlay. Differentiate by date/recency using existing roles and additional text/accessible cues; recency must not imply a PR or significance.
3. Show point date, reps, load, effort (including missing effort) and existing estimated 1RM. Design appropriate exercise, time-range and effort filters with visible applied state and deterministic selection after changes.
4. Cover coincident points, small/dense histories, empty/insufficient/no-reference states, errors/retry, deleted/unavailable exercise, small and large phones, all appearance presets, touch ergonomics and VoiceOver access to values.
5. Use Figma where useful and link exact frames/version if selected; keep external artifacts in Figma and target/screenshots beside the UX contract or PR, not persistent specs. Report conflicts with existing contracts.
6. Record explicit human design approval for the chart, edge states, filter semantics and proposed final entry. T07 cannot begin UI implementation and T08 cannot run UI acceptance tests before this approval; a material design revision renews approval.

## UX contract (proposed; T05 pins the approved target)

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Inspect a set | Choose an observation (or overlapping group), then a specific set | Read exact date, reps, Weight/load, effort and 1RM | Every coincident set remains reachable; missing effort is explicit |
| Filter observations | Select exercise, time range and effort cohort | Chart/reference/readout reflect approved scope | No qualifying sets or reference support has a designed state |
| Open and return — design only | Propose entry from the current selected-exercise context | Preserve exercise/context and existing Back behavior | No production navigation is wired until T09 |

## Specs to update

No design targets in specs. Graduate approved observable decisions to `docs/product/`; update `docs/specs/ui/design-language.md`/`ux-rules.md` only for accepted shared rules.

## Gates

Design review against the approved analytical contract, token/contrast/accessibility review and complete state coverage. No production UI acceptance suite at this stage.

Expected gates are proposals, not approval. Run `./boga test for` on the actual diff and agree every lane beyond `fast` with the operator. Every code PR adds/updates focused Jest coverage and passes `./boga test fast`; run `jest-coverage`, `complexity` and `dependencies` once on the finished PR. Read the owning test directory README first. Docs-only work proposes `docs-check`; any exemption from the normal gates needs explicit operator agreement. Record results and artifacts in the PR, not this card. Run `./boga doctor` before claiming a lane cannot run.
