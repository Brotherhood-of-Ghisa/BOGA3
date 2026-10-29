# COW — draft UX brief

- Status: draft for operator review; not yet an accepted design target.
- Owner: [M39](milestones/M39-group-challenge-of-the-week.md), implemented by
  [T04](tasks/M39-T04-Deliver_CotW_mobile_flows.md).
- Authority: milestone D1–D9 for agreed product direction; remaining T01
  questions stay open. This brief proposes placement and interaction only.
- Before acceptance: capture current Groups / At a glance, group management
  and comparison-form screenshots in the worktree's gitignored mobile
  artifacts tree; link them here or in the implementation PR. No screenshots
  or rendered prototype were produced in this planning update.

## Intended outcome

An admin schedules next week's COW in one short form. Every member can find
the exercise before it starts, follow each metric during the week, and read
the stored final outcome afterwards. Use COW in feature names and copy.

## Proposed placement

Add one COW card to the selected group's At a glance page, before the existing
viewer-local period stepper. The COW card has its own fixed group-calendar
dates; changing the existing summary week never changes the COW context.

The card shows this week's COW, its exercise and Live / Finalizing state, with
an Open COW link. Below it are compact Next COW and Latest results links when
available, plus COW history. A week without a COW shows No COW this week;
members cannot enter or create that week. Only owners/admins see Schedule
next COW, or Manage next COW when it already exists. No new main tab.

These are layout sketches, not pixel targets:

```text
Group: Brotherhood                     [switch]
At a glance | Stream | Leaderboards

COW                              2–8 November
Bench press                              Live
1RM · Improvement · Total Volume
[Open COW]

Next COW       Squat · 9–15 November        >
Latest results Deadlift · 26 Oct–1 Nov      >
COW history                                >
[Schedule next COW]             (admin only)

...existing group week summary...
```

The action is Manage next COW instead of Schedule when the next slot is full;
the sketch lists possible rows, not a requirement to show all rows at once.
Date formatting follows the account preference; dates refer to the COW zone.

## Schedule next COW

Open a standard form from the card. Next week's date range and the group's
zone are read-only context, not editable date fields. Use the existing group
exercise picker; require at least one metric. A review section on the same
form shows dates, exercise and metrics before its one Publish COW action.
Publishing immediately makes the upcoming COW visible to members.

```text
< Back                         Schedule COW

9–15 November
Europe/London

Exercise                         [Choose >]
Metrics
[x] Highest 1RM
[ ] Personal 1RM improvement
[ ] Total Volume

Review
Bench press · Highest 1RM · 9–15 November

[Publish COW]
```

No exercise exists: offer the existing group-exercise creation path to admins,
then return to the retained form. Group zone missing on an older group: require
an explicit admin zone choice first. Propose a zone control in existing group
management, with the creator's device IANA zone as the new-group default;
never infer an existing creator's zone from another member's phone.

Editing an upcoming COW reuses the form. Edit/cancel controls follow the
merged lifecycle contract. Destructive cancellation confirms. An occupied
slot or concurrent admin write preserves input and offers Open existing COW.
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

At the next visit after finalization, Latest results on the group card opens
that outcome, independently of the new live/next COW. History lists completed
COWs newest first and opens the same final detail. This is persistent in-app
reporting, not a modal, a seen-once celebration or a push notification.
Final results never imply a drill-down source workout is still available.
Only provide permitted detail links that remain valid; hide unsafe historical
figures under current disclosure without inventing new winners.

## Shared states and review checklist

Reuse the existing group selector, Sheet/form primitives, rank rows, notices,
focus/poll/pull refresh and online-only writes. Preserve form input on errors.
Offline reads use only already-permitted cached summaries and the standard
last-updated marker; full rankings stay online under existing cache policy.
Loss of group access hides cached content. Distinguish loading, no COW,
upcoming, live, finalizing, final-empty, final, unavailable and error+Retry.

Before acceptance, review placement and reporting, scheduling/edit/cancel,
group-zone setup, long names, small/large phones, keyboard and scroll,
VoiceOver, touch targets and non-colour state cues. T04's UX Contract owns the
flow/acceptance mapping; its PR supplies fresh running-app screenshots against
this accepted target. Delete this brief with T04 and the milestone.
