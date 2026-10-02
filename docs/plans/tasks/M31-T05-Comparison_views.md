# M31-T05 — Compare muscle and exercise histories through time

- Status: `planned`
- Depends on: `M31-T04-Entity_exploration`
- Milestone: `docs/plans/milestones/M31-progress-exploration-and-targets.md`
- Areas: frontend; UI impact: yes

## Objective

Add the multiple-entity comparison accepted in T01 to the exploration context
from T04. Make comparisons readable and meaningful on a phone while retaining
the same period, granularity and metric contracts.

## Scope and decided requirements

Milestone D1–D3 and D5 apply. Use T03's aligned series and compatibility rules;
do not compare quantities with different units or silently normalize values.
Use the accepted comparison form rather than selecting a chart library or
overlay design before the product decision.

## Open — resolve at session start

Confirm accepted visual states, selection limit and behavior when a metric is
unsupported by an entity. Any new chart dependency needs a concrete native,
accessibility and bundle rationale; prefer the existing rendering stack.

## Deliverables and acceptance

1. Add/remove entities from the active context without dismissing analytics;
   labels and selected series are stable and distinguishable without color alone.
2. Compatible series share dates, units and metric definition. Users can inspect
   a bucket with values for every selected entity. Unavailable/incomplete data
   is labelled according to T03; the comparison cannot imply measured zero.
3. Selection limits, zero/one entity, long names, overlapping or empty series,
   loading and retry work in the compact phone layout.
4. Component Jest tests prove add/remove, shared state, compatibility and edge
   states; fresh device captures are compared to the accepted target and the UI
   is presented for staged human review before its agreed PR checks.
5. Delete this card and mark T05 completed in the milestone in this PR.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Compare | Select an entity; add another; inspect a bucket | Every series reports the same period/metric with clear identity | Unsupported metric or selection limit explains the valid next action |
| Refine | Remove an entity or change metric/range/granularity | Selection follows the accepted transition rules | Empty histories and loading never discard a valid comparison silently |

## Specs and gates

Update the shipped comparison semantics in `ui/ux-rules.md`, screen/navigation
docs where affected, and reusable component catalog. Follow T01's review policy;
read test READMEs, add/update Jest, and pass `fast` plus quality targets before
the PR. Propose the smallest relevant device lane. New Maestro scenarios require
the operator's approval; integrated final closeout is T07.
