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

Planning (optional — pick one):
- No plan: go straight to a PR.
- A single plan doc under docs/plans/.
- A milestone + task cards (docs/plans/templates/) for large, multi-PR work.
- If this affects shared behavior, update the relevant project-level specs too.

Verification:
- Run the required tests and quality gates for the changed area.
- Add or update tests for the feature.
- Update docs/specs/runbook files if the change affects shared behavior, UI contracts, data model, or workflow.

Closeout:
- Put gate results and evidence in the PR body.
- If you used a plan, milestone, or task card, move any durable decision into docs/specs/ and delete the plan once the work ships (git history keeps it).
```

## Short version

If you want the simplest possible request, use this:

```text
Implement feature X.
Scope: do A and B, not C.
Keep each PR small.
Update tests and docs/specs as needed.
```

## Notes

- This template is intentionally plain and beginner-friendly.
- Planning is optional and ephemeral (`docs/plans/README.md`): you choose
  whether and how the work is planned.
- For larger work, ask for a plan or a milestone with task cards, then build it
  as several small PRs.
