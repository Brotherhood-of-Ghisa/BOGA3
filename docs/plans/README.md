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

Milestones and task cards are planned and executed with the task protocol
(below). Claude Code users have it as the user-level `/task-protocol` skill,
which orders the steps and takes the BOGA specifics from this section.

## Task protocol (BOGA)

Two phases: **plan together** once, then **execute one task per session**.
AGENTS.md rules (gates, worktree ownership, PR template) apply throughout.
One task = one session = one worktree = one PR, always a local worktree unless
the user says otherwise (cloud containers have no iOS simulator, so most tasks
cannot run their gates there). Never merge a PR yourself unless asked.

**Plan together**

- Milestone: `docs/plans/milestones/M<n>-<slug>.md` from
  `templates/milestone-spec-template.md`. `<n>` is one above the highest
  milestone number in full history (`git fetch --unshallow` first if shallow)
  and in open PRs:
  `git log origin/main --format=%s --name-only | grep -oE '\bM[0-9]+\b' | sort -V | tail -1`.
- One card per PR-sized task: `docs/plans/tasks/<task-id>.md` from
  `templates/task-card-template.md` (ID scheme in the template).
- Land the plan as its own docs-only PR. Task sessions branch from
  `origin/main`, so cards must be merged before execution starts.

**Execute one task**

| Step | BOGA binding |
| --- | --- |
| Open | From the main checkout: `./boga worktree create <branch>` (e.g. `m<n>-t<nn>-<slug>`); `./boga worktree start` inside a harness-made worktree. |
| Load | The card, its milestone, and the AGENTS.md load list for the areas touched; check assumptions against `origin/main`. |
| Design | UI: pin the accepted design target per `docs/specs/ui/ai-design-policy.md`. |
| Build | `./boga test for` lists the required gates; run them to green (AGENTS.md rule 3). Durable decisions go in `docs/specs/**`. |
| Review | `/code-review` and `docs/product/REVIEW.md` on the branch diff; add `/security-review` for auth/RLS/API changes. |
| PR | Delete the card, mark it `completed` in the milestone (last task: delete the milestone). Body per `.github/pull_request_template.md` (lanes run, agreed with the operator). Then `./boga db down`. Optional: `./boga pr wait` in the background to notice the merge. |
| User review | Fix, re-run affected gates, push, `./boga db down`; or reply why not. |
| Merged | Confirm on GitHub (or `pr wait` exit 0), `git fetch origin main`, read the milestone at `origin/main`, offer ready cards as `Execute docs/plans/tasks/<task-id>.md with /task-protocol.` |
| Cleanup | Stop Metro/dev servers, then `./boga worktree release` from the task worktree (removes the slot's Supabase containers/volumes/networks, the lease, the worktree); confirm with `./boga worktree ls`. Closed unmerged: ask, then `release --force`. Never delete lease files by hand. Other sessions' leftovers: `docs/procedures/worktree-cleanup.md`. |

## Lifecycle

- **Ephemeral.** Delete a plan, milestone, or task card in the change that
  ships or abandons its work. There is no archive; git history keeps it.
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
