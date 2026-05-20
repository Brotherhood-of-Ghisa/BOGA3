# Plans

This folder holds **active orchestration plans** consumed by the workflow defined in `docs/operations/task-execution.md`.

## Status

- Default behavior: **direct execution** (no orchestrator).
- The orchestrator is **opt-in**, triggered by the author per the rules below.
- For large/multi-subsystem work, the assistant **must** propose the orchestrator during plan mode before writing the final plan.

## When the orchestrator is used

A session enters orchestrator mode only if either:

1. The user message contains an explicit invocation:

   ```
   execute plan at docs/plans/<plan-name>/
   ```

2. The user message contains the phrase `use orchestration protocol` (or `via the orchestrator`) while referring to an existing `docs/plans/<plan-name>/plan.md`.

Absent one of these, the assistant executes tasks directly (single session, single PR or commit).

## When the assistant must propose the orchestrator

During plan mode, after exploration, the assistant proposes the orchestrator via `AskUserQuestion` (Recommended / Direct) if **any** of these are true:

- Estimated **> 6** distinct task units in the implementation outline that could each become independent PRs.
- Touches **> 3** subsystems (UI, data model, sync, auth, maestro, supabase backend, worktree contract — each counts as one).
- Cross-cutting refactor (renames, route restructuring, shared-primitive extractions touching many call sites).
- Touches contracts marked critical in the always-load specs: `docs/specs/05-data-model.md`, `docs/specs/tech/client-sync-engine.md` (when present), `docs/specs/10-api-authn-authz-guidelines.md`, `docs/specs/12-worktree-config-and-isolation.md`.
- Multi-feature work where ordering matters and partial merges are valuable.
- The user uses words like `large`, `big refactor`, `multi-step`, `phased`, `let's plan this out`, `convert this into tasks`, or asks to convert an existing plan into orchestration form.

The proposal is non-coercive: the user may decline and the assistant falls back to direct execution.

## Plan stamp

Every plan authored under the protocol carries an `## Orchestration` section in its `plan.md` declaring `Status: enabled`, the plan slug used for PR filtering, the concurrency caps in effect, and any deviations from the default protocol. Plans without this section are **not** orchestrator-driven and should not be invoked with `execute plan at …`.

## Folder layout

```
docs/plans/
  README.md                      this file
  <plan-name>/
    plan.md                      entry point per docs/operations/task-execution.md
    designs/                     optional — design/research task outputs
    tasks/                       optional — extracted task cards
```

After audit-pass, the coordinator deletes the plan directory; merged outcomes live in `docs/specs/**`, code, and PR history. Failed audits append remediation cards and the directory stays until the next audit pass.
