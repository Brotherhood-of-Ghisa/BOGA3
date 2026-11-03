# M41-T05-Device_acceptance_and_closeout — Acceptance and closeout

- Status: `planned`
- Depends on: `M41-T04-Dark_mode_choice_and_native_surfaces`
- Milestone: `docs/plans/milestones/M41-complete-appearance.md`
- Areas: frontend; UI impact: review only

## Objective

Get human acceptance of the full appearance experience on a phone, fix what
the pass finds, and close the milestone.

## Scope

- In: a dev-client install on the paired iPhone; a screenshot gallery of key
  screens across Light/Dark × a few background/text choices; fixes (or
  follow-up tasks) for findings; `./boga sweep`; deleting the milestone and
  this card.
- Out: new features.

## Open — resolve with the user at session start

- Which screens and theme combinations make up the gallery.

## Deliverables and acceptance

1. The user accepts the gallery and the on-device pass.
2. Specs describe the shipped behaviour with no plan references.
3. The milestone and this card are deleted.

## Gates

`fast` + `frontend` (macOS) / `frontend-android` (Linux);
`./boga sweep --ref <branch>` (shared UI change).
