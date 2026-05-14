# Sync redesign — execution contract

## Purpose

Defines how the multi-agent system executes the plan in [plan.md](plan.md). Read this
before spawning anything.

## Roles

### Coordinator (the conversation coordinating this work)
- Holds the master view of the plan and task graph.
- Dispatches builder agents per task in dependency-correct order (Wave 1 immediately;
  Wave 2 tasks as soon as their specific dependency PR merges).
- Dispatches reviewer agents when builders deliver PRs.
- Mediates the builder ↔ reviewer loop.
- Pings the human when a PR is reviewer-approved and ready for final merge.
- After every merge, evaluates whether the change introduces deviations affecting other
  in-progress builders; notifies them via SendMessage if so.
- **Does NOT write code itself. Does NOT merge PRs.**

### Builder (one per task)
- Receives: link to `plan.md`, task identifier (e.g. "T3"), worktree assignment.
- Operates in its own git worktree per
  [docs/specs/12-worktree-config-and-isolation.md](../../specs/12-worktree-config-and-isolation.md).
- **(0) Loads project rules first.** Reads `CLAUDE.md` and the docs it points at
  (`AGENTS.md` and the spec docs listed there). Subagents do **not** auto-load these — the
  builder must do it explicitly.
- **(a) Refines the task** by reading the code firsthand (the plan task is a hint, not a
  contract; if the plan is wrong about a detail, the builder corrects it and notes the
  deviation).
- **(b) Implements** the change.
- **(c) Runs the project quality gates** — **NOT** ad-hoc commands. Specifically:
  - `./scripts/quality-fast.sh` for relevant area(s) (`frontend`, `backend`, or no arg for
    both). This wraps lint + typecheck + tests + backend contract suites with the right
    worktree validation.
  - `./scripts/quality-slow.sh` when the change touches UI or e2e-relevant flows.
  - `./scripts/task-closeout-check.sh <task-card-path>` if a task card exists.
  - All gates must pass before opening the PR.
- **(d) Opens a PR** against `main`. PR description must include:
  - Reference to the plan task (e.g. "Plan task T3 — runtime hardening").
  - **Deviations from plan** with reasons.
  - **Quality gates run** — paste the exact commands and a one-line result for each. If a
    gate was skipped, explain why.
- Reports the PR URL back to the coordinator.
- Responds to reviewer feedback by pushing commits + replying on PR until approved.

### Reviewer (one per PR; can re-spawn for re-review)
- Invoked by the coordinator using the `pr-review-toolkit:review-pr` skill (or
  `pr-review-toolkit:code-reviewer` subagent for narrower passes).
- **First**: load `CLAUDE.md` → `AGENTS.md` → the linked specs. Subagents do not auto-load
  them.
- Focus areas (specified by coordinator in the brief):
  - **Project quality gates** — the PR description must include `quality-fast.sh` (and
    `quality-slow.sh` / `task-closeout-check.sh` where relevant) results. If absent or
    incomplete, the reviewer must `gh pr checkout <PR>` the branch and run the missing
    gates themselves. Failing gates → `request-changes`.
  - **Testing** — adequate coverage, real assertions, no skipped/flaky tests.
  - **Completeness** — does the PR fully address the task it claims to address?
  - **Adherence to plan** — deviations are documented and reasonable; nothing snuck in
    that's outside the task.
- Posts review as PR comments.
- Gives explicit verdict: approve / request-changes.

### Human
- Final merge authority on every PR. **The coordinator never merges.**
- Can step in at any point to redirect.

## Per-task workflow

1. Coordinator picks a task whose dependencies are satisfied.
2. Coordinator spawns a builder with: plan reference, task id, worktree assignment.
3. Builder works in worktree.
4. Builder opens PR; reports URL to coordinator.
5. Coordinator spawns reviewer with: PR URL, focus areas.
6. Reviewer reviews; comments on PR; gives verdict.
7. If reviewer requests changes:
   - Builder revises; pushes; reports back.
   - Coordinator re-spawns reviewer for re-review.
8. Repeat until reviewer approves.
9. Coordinator pings human: "PR #N (task T?) is reviewer-approved and ready for merge.
   Branch: …"
10. Human merges (or rejects — back to step 7).
11. Post-merge, coordinator:
    - Marks task complete.
    - Reads the merged PR's deviations log.
    - Identifies in-progress builders affected by deviations; sends SendMessage updates
      so they can incorporate.

## Wave gating

- **Wave 1** (T1, T2, T3, T4): all dispatched at start, in parallel.
- **Wave 2:**
  - T5 dispatched as soon as T1 merges.
  - T6 dispatched as soon as both T1 and T3 merge.
- **Wave 3** (T7): manual operational step. Coordinator pings human with checklist when
  all prior PRs are merged.

## Failure modes & escalation

- **Reviewer keeps rejecting same PR (3+ rounds):** coordinator escalates to human with the
  disagreement summary.
- **Builder blocked on a question requiring product decisions:** builder asks coordinator;
  coordinator escalates to human.
- **Two parallel PRs collide on the same file:** unlikely given task partitioning, but if
  it happens, coordinator decides which builder rebases.
- **Human merges a PR that breaks an in-progress builder's assumptions:** coordinator
  immediately notifies the affected builder via SendMessage.
- **Builder reports the task is fundamentally wrong** (e.g. plan misunderstood the code):
  builder reports to coordinator with explanation; coordinator updates `plan.md`,
  re-briefs builder, and re-runs from step 2.

## What the coordinator tracks

A short status block in [status.md](status.md). For each task: dispatched? PR open? PR URL?
Reviewer verdict? Merged? Deviations summary?

## Out of scope for this contract

- CI configuration (assumed working).
- Deployment / release.
- Any post-merge production verification beyond the test suite.
