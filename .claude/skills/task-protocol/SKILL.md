---
name: task-protocol
description: BOGA's plan-and-execute protocol. Use when the user wants to plan multi-PR work together (milestone + task cards), or hands you a task card to execute in this session (worktree → task-level design → build → review → PR → merge → next cards → cleanup).
argument-hint: "[plan | docs/plans/tasks/<task-id>.md]"
---

# Task protocol

Two phases: **plan together** once, then **execute one task per session**.
AGENTS.md rules (gates, worktree ownership, PR template) apply throughout; this
skill only orders them. Ask the user whenever a step needs their decision; never
merge a PR yourself unless asked.

## Hard rules

- **One task = one session = one worktree = one PR.** Always a local worktree
  (`./boga worktree create <branch>`, or `./boga worktree start` inside a
  harness-made worktree) unless the user says otherwise. Cloud containers have
  no iOS simulator, so most tasks cannot run their gates there.
- **Plans are ephemeral and never referenced.** Code, tests, Maestro flows,
  migrations, specs and other docs never cite a plan path (`docs/plans/...`)
  or a task/milestone ID (`M<n>-T<nn>`, `T-<YYYYMMDD>-<nn>`). State the rule or
  behaviour itself in the owning spec. Commit messages and PR bodies may cite
  them. `docs-check` fails on plan paths outside `docs/plans/**` and
  `docs/brainstorms/**`.
- **Durable decisions graduate** into the owning `docs/specs/**` doc in the PR
  that ships them. Evidence lives in the PR body.

## Phase 1 — Plan together

1. Discuss with the user until agreed: objective, high-level design direction,
   in/out of scope, key decisions, rough task breakdown with dependencies.
   Verify assumptions against the code and specs; don't write production code.
2. Pick the shape with the user (`docs/plans/README.md`). For multi-PR work:
   - Milestone: `docs/plans/milestones/M<n>-<slug>.md` from
     `docs/plans/templates/milestone-spec-template.md`. `<n>` is one above the
     highest milestone number in full history (`git fetch --unshallow` first if
     shallow) and in open PRs:
     `git log origin/main --format=%s --name-only | grep -oE '\bM[0-9]+\b' | sort -V | tail -1`.
   - One card per PR-sized task: `docs/plans/tasks/<task-id>.md` from
     `docs/plans/templates/task-card-template.md`. Each card says what is
     decided and what is left **open** for its session to design.
3. Land the plan as its own docs-only PR (worktree, `./boga test for`, gates,
   PR, cleanup as in Phase 2 steps 5–9). Task sessions branch from
   `origin/main`, so cards must be merged before execution starts.
4. After it merges, offer the first cards (Phase 2 step 8).

## Phase 2 — Execute one task

1. **Open.** From the main checkout: `./boga worktree create <branch>` (branch
   e.g. `m<n>-t<nn>-<slug>`), then work in that path.
2. **Load and check freshness.** Read the card, its milestone, and the
   AGENTS.md load list for the areas touched. Check every card assumption
   against current `origin/main` (code, specs, merged sibling tasks). Report
   drift to the user before building.
3. **Task-level design.** Resolve the card's open questions with the user
   before coding. UI: pin the accepted design target per
   `docs/specs/ui/ai-design-policy.md`. If a decision changes later cards or
   the milestone, update them in this PR.
4. **Build.** Implement with tests; update owning specs. `./boga test for`
   lists the required gates; run them to green (AGENTS.md rule 3).
5. **Review.** Run the built-in review on the branch diff (Claude Code:
   `/code-review`; add `/security-review` for auth/RLS/API changes). Fix every
   real finding; list declined ones in the PR's *Review hard* or *Deviations*
   with the reason. Re-run the gates the fixes touch.
6. **PR.** In the same PR: delete this task card; mark it `completed` in the
   milestone's task breakdown (last task: delete the milestone too). Body per
   `.github/pull_request_template.md`, checked with `./boga pr check --body`.
   Push, open the PR, then `./boga db down`. Tell the user it is ready for
   review. Optional: `./boga pr wait` in the background to notice the merge.
7. **User review.** Address every comment: fix, re-run affected gates, push,
   `./boga db down`; or reply why not.
8. **Merged → offer next tasks.** When the user says it merged (or `pr wait`
   exits 0), confirm the state on GitHub. Then `git fetch origin main`, read the
   milestone at `origin/main`, and list the cards whose dependencies are all
   completed and which have no open PR. For each, give the user a kickoff line
   for a new session and say which can run in parallel:
   `Execute docs/plans/tasks/<task-id>.md with /task-protocol.`
9. **Cleanup (always, last).** Stop any Metro/dev server you started, then from
   the task worktree run `./boga worktree release`: it removes this slot's
   Supabase containers, volumes and networks, the lease, and the worktree.
   Confirm with `./boga worktree ls` and report what was removed. PR closed
   without merge: ask first, then `release --force`. Release failing (e.g.
   Docker down): fix and retry; never delete lease files by hand. Leftovers
   from other sessions: `docs/procedures/worktree-cleanup.md`.
