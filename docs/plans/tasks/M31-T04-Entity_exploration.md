# M31-T04 — Switch entities inside the Progress analytics context

- Status: `planned`
- Depends on: `M31-T03-Analytics_and_exploration_state`
- Milestone: `docs/plans/milestones/M31-progress-exploration-and-targets.md`
- Areas: frontend; UI impact: yes

## Objective

Integrate the accepted exploration layout and state so users can move between
muscles, families and exercises from within analytics. Replace the relevant
30-day control with the accepted four-week range and apply shared granularity.

## Scope and decided requirements

Milestone D1, D2 and D5 apply. Reuse the shared Progress implementation,
heatmaps and UI tokens/primitives. Preserve the accepted session drill-down and
legacy-route behavior. Multiple-series comparison belongs to T05.

## Open — resolve at session start

Pin T01's target/revision and inspect current main for route or metric changes.
Resolve any mismatch before changing the accepted design. Agree the targeted
device check and staged human review/check policy from T01.

## Deliverables and acceptance

1. Entity switching stays inside analytics and applies T03's state model.
   Search/picker behavior supports untrained entities and long names according
   to the accepted target; rapid switching cannot show stale results.
2. Daily/weekly view, range and selected metric/bucket behave as specified, with
   stable back/dismiss behavior, deep-link defaults and completion handoff.
3. UI fits the accepted small phone viewport; accessible labels, focus,
   touch targets, loading/error/empty states and navigation remain usable.
4. Render each relevant accepted state, capture fresh device screenshots and
   record target differences. Present the implemented interaction for staged
   human review; incorporate feedback before its agreed PR checks.
5. Component/navigation Jest tests prove switching and retained context. Reuse
   existing Maestro coverage for native sheet/scroll/focus behavior; any new
   scenario requires operator approval and a reason Jest cannot prove it.
6. Delete this card and mark T04 completed in the milestone in this PR.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Switch entity | Open analytics; set range/metric; choose another entity | Accepted context is retained; chart and title agree | Missing data, rapid taps or errors never mix entity labels and results |
| Change presentation | Select daily/weekly or another accepted range | Same source history follows accepted buckets | Existing selection adjusts by the defined rule, including an empty bucket |
| Drill down and return | Open a session; return to Progress analytics | Accepted navigation restores intended context | Direct link/no back stack has a safe Progress destination |

## Touchpoints, specs and gates

Start at `app/(tabs)/{progress,stats-history}.tsx`, `components/stats/history-sheet.tsx`
and heatmap components. Update `ui/{screen-map,navigation-contract,ux-rules}.md`
and component catalog for changed reusable APIs. Read test READMEs first.
Follow T01's staged review agreement; pass Jest/`fast` and quality targets before
the PR. Propose the smallest relevant iOS lane set; full final closeout remains
in T07 after integrated human acceptance.
