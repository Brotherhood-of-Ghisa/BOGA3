# Groups

### groups.certification · definition · accepted

Certification attests a **set**, not a score. Another current group member,
never the lifter, certifies a record set (one that holds a board entry
or set a record) on a live group exercise. One certification per set:

| Case | Decision |
| --- | --- |
| What it covers | The set: it counts on every Certified board of that exercise (1RM and Volume) |
| Repeat certification of the same set | The first witness stands |
| Withdraw, cancel, or an edit or deletion of the set | Ends the whole certification, on every board |
| Member exercise's per-side/total entry mode changes | Ends affected certifications; switching back restores none |
| Group target-mode, formula or bodyweight preference/contribution/reading changes | Preserve unchanged witnesses |
| After it ends | Only a new certification re-certifies the set |

Why: one witness attests one performance.
Code: `supabase/migrations/20261008160000_group_competition_set_certification.sql`; `apps/mobile/src/groups/competition-session-records-view-model.ts`.

### groups.cow-metrics · calculation · accepted

A CoW compares one group exercise through independent selected rankings:
best weekly 1RM, signed personal 1RM improvement percentage, and summed weekly
Volume. There is no combined winner. Each source set counts once across
linked exercises and repeated blocks. Use existing group effort rules,
scoring units and disclosure, never personal preferences. Each metric has
one All ranking; [[groups.certification]] adds context, never eligibility.
Nonpositive attained scores are unranked; non-finite arithmetic makes only
that member's affected metric unavailable, with no partial score.

Why: compare the same performances without inventing another scoring system.
Code: `apps/mobile/src/groups/cow-scoring.ts`.
Pending: server publication and mobile readers in `supabase/functions/group-eval/` and `apps/mobile/src/groups/`.

### groups.cow-baseline · calculation · accepted

Improvement compares the weekly best with the lifetime best qualifying
group-shared 1RM strictly before the week, frozen from the latest eligible
source/dependency states accepted before start. Resolve removals before
filtering eligibility. Private history and late historical uploads or
corrections never supply this denominator. Both attained values must be
positive; otherwise improvement is unranked. Signed negative and zero
improvements rank normally, descending. Settings periods cannot shorten the
baseline.

Why: reward personal progress against a stable shared reference.
Code: `apps/mobile/src/groups/cow-scoring.ts`.
Pending: frozen source intake in `supabase/migrations/` and `supabase/functions/group-eval/`.

### groups.cow-calendar · definition · accepted

CoW uses a validated group IANA zone, defaulted from its creator, with immutable
UTC Monday-to-Monday half-open bounds respecting DST. Zone changes never move
a published CoW. Admins schedule next week only, before start, with one
non-cancelled published CoW per group/week and no overlapping windows across
zone changes. Exercise/metric edits and cancellation are pre-start only.
Cancellation retains audit and releases the slot for replacement.

Why: every member competes in the same week, independently of viewer location.
Code: `apps/mobile/src/groups/cow-scoring.ts` consumes authoritative bounds.
Pending: group calendar and scheduling in `supabase/migrations/` and `apps/mobile/src/groups/api.ts`.

### groups.cow-participation · definition · accepted

All current members participate automatically on a roster fixed at start.
Midweek joins and rejoins wait for the next CoW. Leaving or removal ends
further contributions but preserves results already accepted while that
membership was active; rejoining cannot resume this week. Current group
authorization still controls reads, including former members' loss of access.

Why: membership changes cannot recruit a different field halfway through a week.
Code: `apps/mobile/src/groups/cow-scoring.ts` consumes the starting roster and first membership end.
Pending: roster capture and authorization in `supabase/migrations/`.

### groups.cow-submissions · definition · accepted

Completed sessions belong wholly to their start week. Completion and every
required contribution dependency must be accepted in the weekly window,
before membership ends. No late-sync grace applies. Latest accepted states,
including removals, govern corrections until that cutoff. Equal full-precision
scores prefer earlier authoritative submission, then member UUID; ranks are
unique ordinals. For 1RM/improvement use the earliest currently qualifying
winning-set receipt; for Volume use the latest counting contribution addition,
revision or removal. Scoring-input edits revise priority even at equal values;
identical retries and unrelated writes do not. Client and worker clocks never
decide ties.

Why: timely submissions remain deterministic through offline sync and evaluator delays.
Code: `apps/mobile/src/groups/cow-scoring.ts`.
Pending: transactional acceptance receipts in `supabase/migrations/`.

### groups.cow-finality · definition · accepted

Ended CoWs store final rankings, units and scoring context automatically,
without an app read. Later source or policy changes cannot rerank them.
Bind one comparison revision, scorer version and unit context at start for
baseline and weekly scoring. A missing eligible comparison at start, or an
in-week context change/archive, makes the outcome unavailable; never migrate
it to new rules. Post-cutoff changes cannot invalidate delayed finalization.
Current disclosure can suppress unsafe stored figures without promoting a
different winner. Finalizing, unavailable final, and valid empty final are
distinct outcomes.

Why: a finished competition has a durable outcome without weakening current privacy.
Code: `apps/mobile/src/groups/cow-scoring.ts` classifies context availability.
Pending: automatic finalization and immutable results in `supabase/functions/group-eval/` and `supabase/migrations/`.
