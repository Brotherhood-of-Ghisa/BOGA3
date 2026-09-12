# Request Template for Dummies

Use this when you want an agent to build a new feature in this repo.

## Copy-paste request

```text
Implement feature: <feature name>

Goal:
- What should the user be able to do?
- What problem does this solve?

Scope:
- In scope:
  - <item 1>
  - <item 2>
- Out of scope:
  - <item 1>
  - <item 2>

Constraints:
- Do not change:
  - <area / file / behavior to preserve>
- Dependencies or assumptions:
  - <dependency or assumption>

Execution:
- Use one task card per session, or a tightly related pair only.
- If the feature is large, split it into follow-up task cards.
- If this affects shared behavior, update the relevant project-level specs too.

Verification:
- Run the required tests and quality gates for the changed area.
- Add or update tests for the feature.
- Update docs/specs/runbook files if the change affects shared behavior, UI contracts, data model, or workflow.

Closeout:
- Fill in the task card completion note.
- Mark the task card completed, blocked, or outdated as appropriate.
- Delete completed or outdated task cards in the same session (git history keeps them).
```

## Short version

If you want the simplest possible request, use this:

```text
Implement feature X.
Scope: do A and B, not C.
Use the right task card(s) and keep each session small.
Update tests and docs/specs as needed, then close out the task card properly.
```

## Notes

- This template is intentionally plain and beginner-friendly.
- It matches the repo rule that feature work should be planned and executed through task cards.
- For larger work, the agent should break the feature into multiple task cards instead of forcing everything into one session.
