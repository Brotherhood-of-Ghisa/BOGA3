# Groups step 2 — group exercises, leaderboards, certification (draft)

- Status: `draft v3` — product spec, iterating. Technical design comes after.
- Source sketch: `docs/brainstorms/2026-09-10-group-activity-stream.md`
  (F2, F3, F4, phases 3–5). Step 1 as-built: `docs/specs/tech/groups-contract.md`.
- **[default]** = proposal awaiting confirmation; **[open]** = needs discussion.

## Spec

### Group exercises and links

1. **Group exercises.** Owner/admins add exercises to the group: copy one from
   the standard catalogue, or create a custom one (name + weight entry: total
   load / per side). They can rename and archive them; an archived exercise
   keeps its links and leaderboards (read-only) but is no longer offered for
   new links.
2. **Links decide what counts.** A set counts for a group exercise only if the
   exercise it was logged under is linked to that group exercise. A member can
   link several of their own exercises to one group exercise (e.g. "Bench" and
   "Bench (hotel gym)"), but each of their exercises links to at most one
   group exercise per group.
3. **Don't overload the existing exercise UI.** Group exercises never appear in
   the default picker or catalogue lists. They show up only when searched for,
   inside a dedicated Link screen, or on the group page (E0).
4. **Links are retroactive.** A link counts every set of that exercise already
   shared into the group (sessions logged while I was a member). Unlinking
   removes them from the boards. Links survive leaving a group; they are
   inactive until I rejoin.

### Group page

5. **Three pages: Stream · Exercises · Leaderboards.** Members moves to the
   header: tapping the member count opens the member list.

### Leaderboards

6. **Four boards per group exercise**, chosen with two toggles:
   **Weight / e1RM** × **Certified / All**.
   - *Weight* — heaviest weight lifted for ≥1 rep.
   - *e1RM* — estimated one-rep max (the estimate the app already uses).
   - *All* — every counting set; *Certified* — only certified sets.
7. **One row per member**: their best set for that board — rank, username,
   value, date. Both Certified and All are ranked. Ties go to the earlier
   date. Former members stay listed, marked "former".
8. **Leaderboards page = one card per group exercise**, showing the podium
   (1st, 2nd, 3rd: name, value, date) on **Certified · e1RM**. Tapping a card
   opens the full board with standings and the two toggles (E1).
9. **Leaderboard history.** Each full board has a history: who held #1, when
   they took it, and with what (E1.3). Depends on a persistent event record —
   see Tech design questions.

### Certification

10. **What is certified is a record set** — a set that is on a board row or has
    a record card. Other sets in a session can't be certified. Any current
    member other than the lifter can certify it; **one certification is
    enough** for it to count on the Certified boards.
11. **Removing.** A certifier can remove their own certification; admins can
    cancel any certification. No disputes. A cancelled set can be certified
    again.
12. **Pinned value.** A certification is for the weight × reps it attested. If
    the lifter later edits or deletes the set, the certification is void.
13. **Where to certify:** from a leaderboard row, or from a record card in the
    stream — the same row detail in both places (E2).

### Stream

14. **Record events.** When a shared set beats the lifter's own best on a
    group exercise, the stream gets a **record card** (a personal record).
    If it also becomes #1 in the group, the card is marked as a
    **group record** — a special case of a personal record. A member's first
    counting set on a group exercise is a record. Record cards appear while
    the session is still in progress, as soon as the set syncs.
15. **One card per record set** [default], listing everything it broke (e.g.
    "PR · Weight", "PR · e1RM", "Group record · e1RM"). Records are measured on
    the All boards; certifying later updates the card rather than adding a new
    one [default].
16. **Retroactive links don't flood the stream**: sets that start counting
    because of a new link produce no record cards. Instead, one **link**
    stream item says what the link changed ("Dave linked Bench (comp grip) —
    now #1 on e1RM"); unlinking does the same.
17. **Voids are shown, not hidden.** If a record set is edited down or
    deleted, its record card stays marked "voided" and a **record removed**
    item says who now holds the record. Lead changes caused by a void, link,
    or certification appear in history with that reason.
18. **Online vs offline.** Certifying and admin actions need a connection and
    fail clearly offline. Logging and linking work offline; their effect on
    boards appears once they sync.
19. **Out of scope for this step:** group gyms and gym filters, time-windowed
    boards, bodyweight/reps-only metrics, member proposals for group
    exercises, disputes, push notifications.

## Experiences

### E0. Linking — slower but out of the way

Every path ends in one of two places: the **Link screen** (E0.3), or, when
picking a group exercise while logging, the **pick sheet** (E0.2).

**E0.1 Picker search (while logging).** The default picker list is unchanged.
When I type a search, matching group exercises appear in a **From your
groups** section **after** my own matches. A **Groups** toggle beside the
search box narrows the list to group exercises only:

```
 bench                                       ← search text
 ── Chest ──────────────────────────────────
     Bench (comp grip)
     Incline Bench
 ── From your groups ───────────────────────
     Bench Press · Iron Brotherhood       linked: Bench (comp grip)
     Bench · Tuesday Crew                 not linked
```

- A group exercise already linked to one of my exercises still lists, showing
  which. Picking it adds **my** linked exercise to the session.
- Picking an unlinked one opens the pick sheet (E0.2).
- With the toggle on and no search text, the list shows all my groups'
  exercises, grouped by group. A `group` search keyword was rejected (not
  discoverable).

**E0.2 Pick sheet (unlinked group exercise, while logging).**

```
 Bench · Tuesday Crew
 Which of your exercises is this?

  ● Bench (comp grip)         (your exercise · 48 sets)   ← suggested
  ○ Choose another of your exercises…
  ○ Add "Bench" as a new exercise

 Your past Bench (comp grip) sets shared with Tuesday Crew will count.
                                               [ Link and add ]
```

- **Suggested** = my copy of the same standard exercise, else the closest
  name match. With no suggestion, "Add as new" is preselected.

**E0.3 Link screen (from one of my exercises).** Opened from:

- the exercise's **⋮** menu in the Exercise Catalog (today: Edit, Delete →
  adds **Link to group exercise…**);
- the exercise card's **•••** menu in the recorder (today: Change exercise,
  Remove exercise → adds **Link to group exercise…**).

The exercise editor itself doesn't change.

```
 Link "Bench (comp grip)"
 Search group exercises…
 ── Linked ─────────────────────────────────
     Bench Press · Iron Brotherhood               [ Unlink ]
 ── Suggested ──────────────────────────────
     Bench · Tuesday Crew                         [ Link ]
 ── All group exercises ────────────────────
   Iron Brotherhood
     Deadlift                                     [ Link ]
     Overhead Press                               [ Link ]
   Tuesday Crew
     …
```

- The search covers **only** group exercises from my groups (not archived).
- **Suggested** = fuzzy match between my exercise's name and group exercise
  names, plus the same standard-catalogue origin.
- A group exercise in a group where this exercise is already linked shows as
  unavailable ("already linked in Iron Brotherhood") — one link per group
  (bullet 2).
- **Link** shows "Your past Bench (comp grip) sets shared with Tuesday Crew
  will count." **Unlink** confirms "Your sets from this exercise will leave
  Iron Brotherhood's leaderboards."

**E0.4 Group page → Exercises.** Lists the group's exercises. Each row shows
my status: "linked: Bench (comp grip)" or **Link your exercise** (opens the
pick sheet without adding anything to a session). Admins add, rename, and
archive here.

**Weight entry.** When my exercise's weight entry differs from the group
exercise's, the pick sheet and Link screen note "Your per-side weights will
show doubled on this group's boards." Boards show the converted value; the
row detail (E2) also shows the value as I logged it.

### E1. Leaderboards

**E1.1 Leaderboards page** — one card per group exercise, Certified · e1RM:

```
 ┌ Bench Press ─────────────────────── Certified · e1RM ┐
 │ 1  Dave     142.5 kg    12 Sep                        │
 │ 2  Sam      138.0 kg    03 Sep                        │
 │ 3  Me       131.0 kg    10 Sep                        │
 │                                        You: 3rd       │
 └───────────────────────────────────────────────────────┘
 ┌ Deadlift ────────────────────────── Certified · e1RM ┐
 │ No certified sets yet · 3 uncertified                 │
 └───────────────────────────────────────────────────────┘
```

- "You: Nth" shows when I'm outside the podium or unranked [default].
- Archived exercises sit at the bottom, marked "archived".

**E1.2 Full board** — tapping a card:

```
 Bench Press                        [ Weight | e1RM ]  [ Certified | All ]
 ─────────────────────────────────────────────────────────────────────
  1  Dave           140 kg × 1      12 Sep        ✓
  2  Sam            135 kg × 2      03 Sep        ✓
  3  Me             130 kg × 1      10 Sep        ○ uncertified
  4  Alex (former)  120 kg × 3      02 Jul        ✓
 ─────────────────────────────────────────────────────────────────────
 History
```

- Opens on the card's view (Certified · e1RM); the toggles switch in place.
- On *All*, each row shows ✓ certified / ○ uncertified.
- Tapping a row opens E2.

**E1.3 History** — for the board's current toggles, newest first:

```
 14 Sep   Sam back to #1    138.0 kg  (Dave's 142.5 kg removed — set edited)
 12 Sep   Dave took #1      142.5 kg  (from Sam, 138.0 kg)
 05 Sep   Sam took #1       138.0 kg  (linked Bench (hotel gym))
 20 Aug   Dave set the first record   135.0 kg
```

- Lead changes only; no "board as of date" view.

### E2. Row detail (shared by leaderboard rows and record cards)

A sheet over the board or stream:

```
 Dave · Bench Press
 140 kg × 1   (e1RM 140 kg)
 12 Sep 2026 · Iron Temple
 Logged as "Bench (comp grip)"
 ✓ Certified by Sam · 12 Sep          [ Remove my certification ]
                                      [ Cancel certification ]   ← admins
 [ Certify ]                          ← when uncertified, not the lifter
 [ View full session → ]              → friend's session view
```

### E3. Record card in the stream

Sits with the session it came from (sorted by session start) [default].

```
 🏆 Dave — group record
 Bench Press  140 kg × 1
 PR · Weight   Group record · Weight   PR · e1RM
 ○ Not certified yet                   [ Certify ]
```

- Tapping the card opens E2; **Certify** on the card does the same as in E2.
- The session card also gets a small "2 records" highlight linking to them.

## Decisions

| # | Decision |
| --- | --- |
| 1 | A member's first counting set on a group exercise is a record. |
| 2 | Record cards appear during an in-progress session, as sets sync. |
| 3 | Only record sets (board rows, record cards) can be certified. |
| 4 | A certification cancelled by an admin can be given again. |
| 5 | No claims, no disputes; one certification suffices; admins can cancel. |
| 6 | Weight-entry mismatch is converted: boards show values in the group exercise's mode (per side ×2 = total load; total ÷2 = per side), for both Weight and e1RM. Record detection uses the converted value. |
| 7 | ~~Group exercises listed in the Exercise Catalog tab~~ — superseded by #9. |
| 8 | Archiving a group exercise keeps links and a read-only board; it is no longer offered for new links. |
| 9 | Group exercises stay out of the default picker and catalogue lists: they appear in picker search results (after my matches), on the Link screen (from the ⋮ / ••• menus), and on the group page's Exercises tab. |
| 10 | Group page = Stream · Exercises · Leaderboards. |
| 11 | Leaderboards page: one podium card per exercise on Certified · e1RM; full board on tap with both toggles. |
| 12 | Leaderboard history = lead changes per board only. |
| 13 | Picker search: group matches in a bottom section, plus a Groups toggle that shows group exercises only. |
| 14 | Members live in the group-page header (tap the member count). |
| 15 | A voided record keeps its card (marked voided) and adds a "record removed" item to the stream; the resulting lead change appears in history. |
| 16 | Link / unlink that moves the boards adds a link item to the stream; resulting lead changes appear in history. |
| 17 | Links are the member's own synced data: linking works offline. |

## Open questions

- None. Technical design: `docs/plans/group-exercises-tech-design.md`.
