# <task-id> — <title>

<!--
Starter for a task card (docs/plans/README.md). Drop any section that doesn't
help. File: docs/plans/tasks/<task-id>.md, where <task-id> is
<Milestone ID>-T<NN>-<Short_name> (e.g. M33-T04-Do_something) or
T-<YYYYMMDD>-<NN>-<Short_name> without a milestone.
One card = one session = one worktree = one PR (.claude/skills/task-protocol).
The executing PR deletes this card; evidence goes in the PR body.
-->

- Status: `planned | in_progress | blocked`
- Depends on: `<task-id>`, … | none
- Milestone: `docs/plans/milestones/<M#>-<name>.md` | none
- Areas: docs | frontend | backend | cross-stack; UI impact: yes | no

## Objective

What this task must achieve, in 2–4 sentences.

## Scope

- In:
- Out:

## Decided

Decisions already agreed during planning (cite the milestone's D# entries);
the session does not reopen them without the user.

## Open — resolve with the user at session start

Design or approach questions this session must settle before coding. UI: the
accepted design target (`docs/specs/ui/ai-design-policy.md`).

## Deliverables and acceptance

1.
2.

## UX contract (UI tasks only)

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| | | | |

## Specs to update

- `<docs/specs/... path>` — why

## Gates

Expected from `./boga test for` (the command, not this list, is authoritative):
`fast` | `backend` | `frontend` | `ios-sync-e2e` | `ios-groups-e2e` | …
