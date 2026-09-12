# Plans (optional, ephemeral)

Planning docs live here. They are **working notes, not source of truth**, and
they are **optional**: the user chooses how each piece of work is planned.

## Pick a shape (or none)

| Shape | When it fits | How |
| --- | --- | --- |
| No plan | Small or obvious work | Go straight to a PR; the PR body carries the evidence. |
| Single plan doc | Medium work, one or a few PRs | `docs/plans/<short-name>.md`, in whatever structure helps. |
| Milestone + task cards | Large work split into parallel PRs | `milestones/<M#>-<name>.md` + `tasks/<task-id>.md`, starting from `templates/`. |
| Anything else | The user's call | Keep it under `docs/plans/`. |

The templates in `templates/` are starting points, not requirements. Drop any
section that doesn't help.

## Lifecycle

- **Ephemeral.** Delete a plan, milestone, or task card in the change that
  ships or abandons its work. There is no archive; git history keeps it.
- **Graduate durable decisions.** Anything that must stay true after the plan
  is gone goes into the owning `docs/specs/**` doc, such as a product decision,
  an architecture choice, the data model, an auth rule, or a technical contract.
  Do that in the PR that ships it.
- **Evidence lives in the PR.** Gate results, artifacts, and screenshots go in
  the PR body (`.github/pull_request_template.md`), not in a plan file that
  will be deleted.

## Reading rule

Agents read a plan only when the user points them at it (`AGENTS.md`).
Everything else here may be stale.

## Optional helpers

- `./scripts/task-bootstrap.sh <card>` prints a context-freshness report for
  a task card.
- `./scripts/task-closeout-check.sh <card>` checks a card's closeout fields.
