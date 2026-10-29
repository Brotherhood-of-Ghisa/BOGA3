# CoW — UX brief

- Status: both attached mockups approved by the operator on 2026-10-29:
  detailed chronological browser with horizontal banner, and Today top-three
  card with in-card metric tabs. The no-current-CoW fallback and remaining
  admin screens still need decisions.
- Owner: [M39](milestones/M39-group-challenge-of-the-week.md), implemented by
  [T04](tasks/M39-T04-Deliver_CotW_mobile_flows.md).
- Authority: milestone D1–D9 for agreed product direction; remaining T01
  questions stay open. Agreed entry points are recorded below; remaining
  layout and interaction details are proposals.
- Implementation references: capture current Groups / At a glance, group
  management and comparison-form screenshots for the remaining flows, in the
  worktree's gitignored mobile artifacts tree. The approved generated mockups
  are design inputs, not running-app evidence or interaction-tested prototypes.
  The operator supplied the current Today / Groups reference screenshot.

## Approved browser target

The operator approved a chronological page with
This week, Next week and Past CoWs visible together. The current CoW has a
metric selector and top-three ranking preview, followed by Full standings;
upcoming and past CoWs are compact rows. No Current/Next/History tab bar or
week stepper on this browser.

Requested refinement: arrange the top current-CoW information horizontally
like the first concept, preserving the third concept's formatting. The
exercise and Live state sit left; dates and time zone sit right. Keep all
other sections, type, colours and figures unchanged. The attached revision is
approved as the member browser target.

![Approved chronological CoW browser with horizontal banner](assets/M39-cow-browser.png)

Generated with the built-in image-generation tool. Prompt: edit the selected
chronological concept only, use the first concept solely for two-column header
alignment, retain the same date range/zone, and preserve all other content and
formatting. This image covers the member browser; admin forms still need
their own visual design.

## Intended outcome

An admin schedules next week's CoW in one short form. Every member can find
the exercise before it starts, follow each metric during the week, and read
the stored final outcome afterwards. Use CoW in feature names and copy, with plural CoWs; preserve that casing
even in controls whose surrounding labels use uppercase.

## Agreed placement and navigation

The operator clarified two distinct surfaces: the selected detailed browser
is accessible from Groups; when this week's CoW exists, Today / Groups shows
it in a separate small card for the selected group. The absence case is open
below. The earlier At a glance summary
placement was a misunderstanding and is replaced by this distinction.

Today shows the current exercise, week, status and the first three places of
the selected leaderboard. Compact 1RM / Improvement / Volume tabs switch
between the enabled metrics inside the card; no navigation or swipe is needed.
Only metrics enabled for that CoW are offered. Render at most three qualifying
server-ranked rows with their correct unit; do not substitute the viewer for
third place or fabricate missing results. Keep the preview height stable when
switching to a metric with fewer results.

The header/chevron opens the detailed browser with the same group, displayed CoW
and selected metric. Metric controls stay independent of that link; the whole
card is not one nested press target. There are no upcoming/history rows or
admin actions. A prior result or next week's challenge must never be presented
as current. The authoritative group-calendar
window determines this card; the existing Today working-set board keeps its
own viewer-local week. No new main tab.

Approved placement: between Today's existing group week board and Recent.
Keep the group's existing header/switch and working-set board intact. Recent remains the
elastic, internally scrollable part; adding the small card must not push it
or the tab bar off-screen. Long names wrap without reducing type size.

![Approved current-CoW top-three card on Today / Groups](assets/M39-cow-today.png)

Generated with the built-in image-generation tool. Prompt: refine the current
Today card with three metric tabs and the selected ranking's top-three rows;
retain the current exercise/week/status and header detail link. Preserve the
theme, type, existing working-set board and tab bar; consume Recent's spare
space, allowing its list to scroll. Both the behavior and attached layout are
approved. The full browser stays separate.

### Open: no CoW this week

The operator is choosing between hiding the Today card completely and showing
the previous calendar week's stored final leaderboard. The proposed fallback
uses an explicit Last week / Final label and dates, retains top-three metric
browsing, and hides the card if that prior week has no final CoW. It never
shows a stale Live result or searches arbitrarily far back. There is no
placeholder card. Do not implement either choice as settled until confirmed.

Groups provides an entry to the secondary detailed CoW browser. Its exact
entry-link layout remains to be designed; it does not embed the full browser
or require another duplicate weekly summary card.

Scheduling belongs on the individual group page (the existing group
management screen), which opens a secondary CoW page. Owners/admins can create
or edit there; every member can view and browse CoWs. The Today summary
is a reading entry, with no scheduling/editing controls. Keep the same selected
group/CoW across both entries, and return Back to the page that opened it.

The secondary page uses the selected chronological browser for current/upcoming
CoWs and past results. Concrete route names and form layout remain for T04; creation/editing
must happen on a secondary page, not an inline Today form.

These are layout sketches, not pixel targets:

```text
Today: Plan | You | Groups
...existing selected group's header and week board...

CoW                         26 Oct – 1 Nov 26
Bench press                         Live   >
[1RM] | Improvement | Volume
1 GoldmanBoyo                         112.5
2 You                                 108.0
3 Jemiliano Snr                       103.0

...existing Recent sessions...

Groups
CoWs                                       >

Individual group page
CoWs                                       >
[Schedule next CoW]             (admin only)

Secondary CoW page
This week: current CoW and ranking preview
Next week: upcoming CoW
Past CoWs: final results
```

The group-page admin action is Edit next CoW when the next slot is full;
both actions open the secondary CoW page in the appropriate mode. The sketch's
admin controls remain proposals; the browser direction is selected above.
Browser/form date formatting follows the account preference; Today uses
[[copy.calendar-dates]]. CoW dates refer to the group zone on both surfaces.

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

Today never labels an ended previous week's CoW as current; its optional
explicitly labelled last-week fallback remains open above. Stored outcomes
live under Past CoWs in the detailed browser, newest first, with the same final
detail opened from there. Both Groups and the Today card can reach the browser;
admin scheduling remains on the individual group page. This is persistent in-app
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

Settle the no-current-week fallback and remaining group-entry/admin form
targets before implementing those flows. Verify the approved layouts with
long names, small/large phones, keyboard/scroll, VoiceOver, touch targets and
non-colour state cues in the running app. T04's UX Contract owns the
flow/acceptance mapping; its PR supplies fresh running-app screenshots against
this accepted target. Delete this brief and its attached mockups with T04 and
the milestone.
