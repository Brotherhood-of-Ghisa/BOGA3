# Plans (optional, ephemeral)

Planning docs live here. They are **working notes, not source of truth**, and
they are **optional**: the user chooses how each piece of work is planned.

## Pick a shape (or none)

| Shape | When it fits | How |
| --- | --- | --- |
| No plan | Small or obvious work | Go straight to a PR; the PR body carries the evidence. |
| Single plan doc | One PR that needs design notes | `docs/plans/<short-name>.md`, in whatever structure helps. |
| Engine server plan | Multi-PR work | The engine plugin's `engine` skill, `plan <ask>` mode. The plan lives only on the engine server, never in repo files (`AGENTS.md`, "Engine plugin"). |
| Anything else | The user's call | Keep it under `docs/plans/`. |

## Lifecycle

- **Ephemeral.** Delete a plan in the change that ships or abandons its
  work. There is no archive; git history keeps it.
- **Never referenced.** Code, tests, flows, migrations, specs, and other docs
  never cite a plan path or a task/milestone ID. Commit messages and PR bodies
  may. `docs-check` fails on a `docs/plans/<file>` path or a milestone/task ID
  outside `docs/plans/**` and `docs/brainstorms/**`.
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
