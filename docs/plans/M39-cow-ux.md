# CoW — draft UX brief

- Status: placement/navigation agreed on 2026-10-29; visual layout still draft,
  not yet an accepted design target.
- Owner: [M39](milestones/M39-group-challenge-of-the-week.md), implemented by
  [T04](tasks/M39-T04-Deliver_CotW_mobile_flows.md).
- Authority: milestone D1–D9 for agreed product direction; remaining T01
  questions stay open. Agreed entry points are recorded below; remaining
  layout and interaction details are proposals.
- Before acceptance: capture current Groups / At a glance, group management
  and comparison-form screenshots in the worktree's gitignored mobile
  artifacts tree; link them here or in the implementation PR. No screenshots
  or rendered prototype were produced in this planning update.

## Intended outcome

An admin schedules next week's CoW in one short form. Every member can find
the exercise before it starts, follow each metric during the week, and read
the stored final outcome afterwards. Use CoW in feature names and copy, with plural CoWs; preserve that casing
even in controls whose surrounding labels use uppercase.

## Agreed placement and navigation

The operator confirmed that the CoW summary belongs on the selected group's
At a glance page and appears immediately, without opening another page first.
Proposed placement is before the existing viewer-local period stepper. The
CoW has fixed group-calendar dates; the summary's week selector cannot move it.

Show the current CoW's exercise, dates, metrics and state directly in that
summary. Open CoW opens the secondary CoW page with that CoW selected. A week
without a CoW shows No CoW this week and a browsing link; it cannot be created
midweek. No new main tab.

Scheduling belongs on the individual group page (the existing group
management screen), which opens a secondary CoW page. Owners/admins can create
or edit there; every member can view and browse CoWs. The At a glance summary
is a reading entry, with no scheduling/editing controls. Keep the same selected
group/CoW across both entries, and return Back to the page that opened it.

The secondary page provides current/upcoming CoWs and past results. Concrete
route names and its browsing/form layout remain for T04; creation/editing
must happen on a secondary page, not an inline At a glance form.

These are layout sketches, not pixel targets:

```text
Group: Brotherhood                     [switch]
At a glance | Stream | Leaderboards

CoW                              2–8 November
Bench press                              Live
1RM · Improvement · Total Volume
[Open CoW]

...existing group week summary...

Individual group page
CoWs                                       >
[Schedule next CoW]             (admin only)

Secondary CoW page
Current | Upcoming | History
...selected CoW / results / permitted editor...
```

The group-page admin action is Edit next CoW when the next slot is full;
both actions open the secondary CoW page in the appropriate mode. The sketch's
browsing controls and styling are proposals, not a finalized layout.
Date formatting follows the account preference; dates refer to the CoW zone.

## Schedule next CoW

From the individual group page, Schedule next CoW opens the creation form on
the secondary CoW page. Next week's date range and the group's zone are
read-only context, not editable date fields. Use the existing group
exercise picker; require at least one metric. A review section on the same
form shows dates, exercise and metrics before its one Publish CoW action.
Publishing immediately makes the upcoming CoW visible to members.

```text
< Back                         Schedule CoW

9–15 November
Europe/London

Exercise                         [Choose >]
Metrics
[x] Highest 1RM
[ ] Personal 1RM improvement
[ ] Total Volume

Review
Bench press · Highest 1RM · 9–15 November

[Publish CoW]
```

No exercise exists: offer the existing group-exercise creation path to admins,
then return to the retained form. Group zone missing on an older group: require
an explicit admin zone choice first. Propose a zone control in existing group
management, with the creator's device IANA zone as the new-group default;
never infer an existing creator's zone from another member's phone.

Editing an upcoming CoW reuses the form. Edit/cancel controls follow the
merged lifecycle contract. Destructive cancellation confirms. An occupied
slot or concurrent admin write preserves input and offers Open existing CoW.
An uncertain publish response refreshes before retry; it never creates a
second definition. If next week begins while the form is open, reject stale
dates and require review of the newly available next week before publishing.

## Standings, reporting and history

The detail page identifies group, exercise, week and zone; show metric
selectors only for the chosen metrics, and one ranking at a time. Reuse rank
rows. Keep attained 1RM in the group's unit distinct from improvement %.
Missing baseline is an unranked improvement state; other metrics remain
available. There is no combined winner or weekly certification action.

Upcoming: exercise, metrics and start date, with no ranking yet. Live: current
standings and end date/time. After the deadline: Finalizing until the server
returns its stored outcome. Final: the per-metric winner or tied winners and
the rankings, or No qualifying results. Tie presentation follows T01; never
invent an overall winner. A user's ineligible/not-yet-participating state is
visible without an enrolment control.

After finalization, the At a glance summary can show the latest final outcome
until a new current CoW starts. Browsing from the group page or summary opens
the secondary CoW page, where History lists stored results newest first and
opens the same final detail. The exact latest-result summary remains a visual
design proposal. This is persistent in-app
reporting, not a modal, a seen-once celebration or a push notification.
Final results never imply a drill-down source workout is still available.
Only provide permitted detail links that remain valid; hide unsafe historical
figures under current disclosure without inventing new winners.

## Shared states and review checklist

Reuse the existing group selector, Sheet/form primitives, rank rows, notices,
focus/poll/pull refresh and online-only writes. Preserve form input on errors.
Offline reads use only already-permitted cached summaries and the standard
last-updated marker; full rankings stay online under existing cache policy.
Loss of group access hides cached content. Distinguish loading, no CoW,
upcoming, live, finalizing, final-empty, final, unavailable and error+Retry.

Before visual acceptance, review the summary and secondary-page layouts,
reporting, scheduling/edit/cancel, group-zone setup, long names, small/large phones, keyboard and scroll,
VoiceOver, touch targets and non-colour state cues. T04's UX Contract owns the
flow/acceptance mapping; its PR supplies fresh running-app screenshots against
this accepted target. Delete this brief with T04 and the milestone.
