---
task_id: M26-T07-Validate_and_close_four_tab_navigation
milestone_id: "M26"
status: planned
ui_impact: "yes"
areas: "docs|frontend|cross-stack"
runtimes: "docs|node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend; all path-specific lanes from ./boga test for"
docs_touched: "docs/specs/ui/*.md as required by final audit; milestone/task docs deleted at closeout"
---

# M26-T07 — Validate and close the four-tab navigation milestone

## Task metadata

- Status: `planned`
- Session interaction mode: `interactive`
- Parent milestone: `docs/plans/milestones/M26-four-tab-navigation.md`
- Depends on: M26-T06
- UI Impact: `yes`

## Context freshness at task start

- Run the task bootstrap helper and record branch/HEAD.
- Reread required specs, UI bundle, all relevant test READMEs, and the completed
  M26 PR summaries.
- Run fresh route, screen, shared-component, and test inventories; treat this
  card as a checklist, not implementation truth.

## Objective

Prove the shipped four-tab navigation is complete, accessible, visually sound,
compatible with critical legacy flows, and accurately documented; then remove
the ephemeral M26 plan.

## Figma guidance

- [Approved board](https://www.figma.com/design/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=8-363)
- [Primary navigation prototype](https://www.figma.com/proto/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=0-1&p=f&t=semh9yQSkSY6O3h6-0&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=8%3A737&show-proto-sidebar=1)
- [Active-session prototype](https://www.figma.com/proto/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=0-1&p=f&t=semh9yQSkSY6O3h6-0&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=8%3A1044&show-proto-sidebar=1)

## UX contract

### Critical journey sweep

- Trigger: run the milestone verification fixture on clean seeded data.
- Steps: exercise every approved Figma journey plus auth, empty, offline, error,
  and legacy-entry cases.
- Success outcome: all capabilities are reachable with correct ownership,
  feedback, and Back/resume behavior.
- Failure/edge outcome: any missing flow, invented Progress metric, clipped tab,
  or silent failure blocks closeout.

## Scope

- Audit contract-to-code and Figma-to-code coverage.
- Run targeted tests and all required repository gates.
- Capture key phone-size and failure-state screenshots.
- Correct documentation drift discovered by the audit.
- Delete M26 milestone/task files in the closing PR after evidence is recorded.

Out of scope: unrelated polish or new feature work found during review; record it
as a follow-up only when it is not a stop-ship defect.

## Acceptance criteria

1. All milestone acceptance criteria are mapped to code/tests/evidence.
2. Critical journeys pass: planned start, empty start, planner entry, active
   resume, Progress dashboard/history/heat maps, group entry, exercise database,
   settings/account, and tab switching.
3. Empty, signed-out, offline, invalid-param, and failed-write/launch states
   provide explicit feedback.
4. VoiceOver labels/roles, focus order, touch targets, and color-independent
   meaning meet the documented baseline.
5. 375 pt and larger-phone captures show no clipped labels, horizontal scroll,
   or recorder/tab overlap.
6. A code/search audit finds no prototype-only/new analytics in Progress.
7. `./boga test for` has been used to enumerate requirements; `./boga test fast`,
   `./boga test frontend`, and all additional triggered lanes are green.
8. UI specs describe current behavior, and the M26 plan/cards are deleted in
   the closing PR.

## Verification matrix

| Journey | Automated expectation | Visual evidence |
| --- | --- | --- |
| Today -> planned session | Maestro + materialization assertion | default Today + planned recorder |
| Today/Train -> active resume | Maestro + one-draft assertion | active Today + focused recorder |
| Train -> empty session | Maestro + repository assertion | Train + empty recorder |
| Train -> planning | route/interaction assertion | Start and Planning states |
| Progress -> history | Maestro + route/data assertion | dashboard + full history |
| Progress -> heat map | Maestro + existing-metric assertion | daily and weekly heat map |
| More -> groups | Maestro + auth/offline assertion | hub + groups state |
| More -> exercise database | Maestro + route assertion | hub + catalog management |
| Legacy routes/deep links | route tests + selected Maestro flows | N/A unless behavior differs visually |

## Mandatory gates and evidence

- `./boga test for`
- `./boga test fast`
- `./boga test frontend`
- Any additional backend, sync, groups, or MCP lane reported by the diff trigger.
- `./boga pr check --body <file>` before the closing PR.
- Record actual gate artifacts/results in the PR body; never copy estimates into
  this card.

## Completion note

- What changed:
- Contract-to-evidence mapping:
- What tests ran:
- Visual evidence:
- Follow-ups:
