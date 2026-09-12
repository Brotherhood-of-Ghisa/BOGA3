# Milestone Spec Template

> Optional starter for the milestone + task-card workflow
> (`docs/plans/README.md`). Drop any section that doesn't help. A milestone is
> ephemeral: it is deleted, with its task cards, when its work ships.

## Milestone metadata

- Milestone ID: `M#`
- Title:
- Status: `planned | in_progress | completed | blocked | outdated`

## Parent references

- Project directives: `docs/specs/README.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`

## Milestone objective

Describe the outcome this milestone must achieve.

## In scope

- 

## Out of scope

- 

## Deliverables

1. 
2. 
3. 

Rule (when applicable): if the milestone introduces a new runtime, deployment surface, or test layer, include a deliverable/task to update `docs/specs/06-testing-strategy.md` and relevant template(s) and name the owner of hosted/deployed smoke validation if it is deferred.

## Acceptance criteria

1. 
2. 
3. 

## Task breakdown

List planned task cards for this milestone.

1. `docs/plans/tasks/<task-id>.md` - short description
2. `docs/plans/tasks/<task-id>.md` - short description

Rule:
- use `docs/plans/tasks/<task-id>.md` for active/planned/blocked cards
- mark a task's entry `completed` when its card is deleted at closeout (git history keeps the card)

## Risks / dependencies

- 

## Closeout

- Keep milestone `Status` and the task breakdown current while work is in flight.
- Before closing, move every durable decision into its owning `docs/specs/**`
  doc (product, architecture, data model, auth, technical contract).
- Put final verification evidence in the closing PR body.
- Delete this spec and its task cards in the closing PR (git history keeps them).
