---
task_id: M26-T05-Build_More_hub
milestone_id: "M26"
status: planned
ui_impact: "yes"
areas: "docs|frontend"
runtimes: "docs|node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test frontend; conditional ./boga test ios-groups-e2e when group paths change"
docs_touched: "docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/ux-rules.md"
---

# M26-T05 — Build the More hub

## Task metadata

- Status: `planned`
- Session interaction mode: `interactive`
- Parent milestone: `docs/plans/milestones/M26-four-tab-navigation.md`
- Depends on: M26-T01
- UI Impact: `yes`

## Context freshness at task start

- Run the task bootstrap helper and record branch/HEAD.
- Reread required specs, group contract/auth guidance, and relevant test README.
- Inventory existing group join/create/manage, Settings, profile, connected
  agents/MCP, exercise catalog, import/archive, and developer-only destinations.

## Objective

Create a scalable secondary-feature hub so new tools can be added without
expanding the persistent tab bar.

## Figma guidance

- [Primary prototype](https://www.figma.com/proto/mrItXBs0wGf0mHEJy8fPqQ/BOGA-%C2%B7-Scalable-navigation-proposals?node-id=0-1&p=f&t=semh9yQSkSY6O3h6-0&scaling=min-zoom&content-scaling=fixed&starting-point-node-id=8%3A737&show-proto-sidebar=1)
- Frames: `04 More · Hub`, `11 More · Groups`,
  `12 More · Exercise database`.
- Category labels and hierarchy are guidance; actual rows must correspond to
  real destinations and auth/dev availability.

## UX contract

### Discover or manage groups

- Trigger: choose Groups from More.
- Steps: join with a code, create a group, or open current group management.
- Success outcome: existing group routes/actions are reached with their current
  authorization and offline behavior.
- Failure/edge outcome: signed-out and offline writes explain that nothing
  changed; group stream activity itself remains surfaced on Today.

### Manage the exercise database

- Trigger: choose Exercise database.
- Steps: search, create/edit/import/archive through existing catalog flows.
- Success outcome: catalog administration is reachable without making it a
  persistent tab.
- Failure/edge outcome: validation/destructive confirmations retain current
  behavior and contextual recorder selection remains separate.

### Open tools and account destinations

- Trigger: choose MCP/integrations, Settings/account, or another real tool.
- Steps: navigate through current routes/external transition rules.
- Success outcome: only available destinations are shown and their auth/dev
  gates are preserved.
- Failure/edge outcome: external launch/auth errors remain inline.

## Scope

- More hub with Community, Tools, and Library & Account grouping.
- Links/adapters to real destinations only.
- More-owned group discovery/administration and exercise-database entry.
- Preserve existing account, MCP, external-browser, and dev-mode safeguards.

Out of scope: implementing new MCP tools, new group capabilities, or changing
catalog business rules.

## Acceptance criteria

1. Every shown row has a working destination and clear accessible name.
2. Group discovery/admin is under More; joined-group activity remains on Today.
3. Exercise database covers current create/edit/import/archive management, while
   in-session exercise selection remains contextual to Train/recorder.
4. MCP/integrations, Settings/account, and connected-agent behavior preserve
   current auth and external-navigation contracts.
5. Developer-only tools use `isDevMode`; no direct `__DEV__` checks are added.
6. Signed-out, offline, external-launch-failure, and destructive flows retain
   explicit feedback.
7. Visual evidence covers More, group entry, and exercise database on small and
   larger phones.

## Implementation notes

- Prefer a declarative section/row model for future secondary destinations.
- Do not expose empty placeholder rows for hypothetical features.
- Reuse current destination screens; this task changes information architecture,
  not their domain logic.

## Verification

- Unit/integration: row availability, route targets, auth/dev filtering,
  external launch failure.
- Maestro: More -> join/manage groups; More -> exercise database; More ->
  Settings/account.
- Gates: `./boga test fast`, `./boga test frontend`; also
  `./boga test ios-groups-e2e` if group-owned paths change.

## Completion note

- What changed:
- What tests ran:
- Visual evidence:
- What remains:
