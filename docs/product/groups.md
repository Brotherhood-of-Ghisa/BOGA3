# Groups

### groups.medals · calculation · accepted

Medals count current podium ownership across unarchived exercises' default-metric
All boards, preserving server places and former holders. Rank stable identities
by gold, silver, bronze; equal tuples share competition rank, ordered by name
then ID. Zero-medal members remain unranked. Search never narrows the tally;
rebuilding withholds it entirely. Corrections, overtakes, archival and metric
changes can redistribute medals. CoWs confer none; there is no award ledger.

Why: compare podium breadth.
Code: `apps/mobile/src/groups/medal-view-model.ts`.

### groups.certification · definition · accepted

Another current member, never the lifter, certifies a **set** holding a board
entry or record on a live group exercise. One certification per set covers
every eligible Certified board:

| Case | Decision |
| --- | --- |
| Repeat | First witness stands |
| Withdrawal, cancellation, set edit/deletion | Ends it on every board |
| Member exercise's per-side/total entry mode changes | Ends affected certifications; switching back restores none |
| Group target-mode, formula or bodyweight preference/contribution/reading changes | Preserve unchanged witnesses |
| Ended | Requires a new certification |
| Default scope | All; Certified is a toggle |

Why: one witness attests one performance.
Code: `supabase/migrations/20261008160000_group_competition_set_certification.sql`; `apps/mobile/src/groups/competition-session-records-view-model.ts`; `DEFAULT_BOARD_SCOPE` in `apps/mobile/src/groups/board-view-model.ts`.

### groups.hold-ranking · calculation · accepted

Hold comparisons rank members' best qualifying single sets by seconds.
Weight affects neither score nor ties. Existing Effort, certification and tie
rules apply. Duration is never normalized by bodyweight. Repetition comparisons
exclude Holds; CoWs remain repetition-only.

Why: longer Holds win regardless of weight.
Code: `apps/mobile/src/groups/competition-score.ts`.

### groups.cow-metrics · calculation · accepted

A CoW compares one group exercise through independent selected rankings:
best weekly 1RM, signed personal 1RM improvement percentage, and summed weekly
Volume. There is no combined winner. Each source set counts once across
linked exercises and repeated blocks. Use existing group effort rules,
scoring units and disclosure, never personal preferences. Each metric has
one All ranking; [[groups.certification]] adds context, never eligibility.
Nonpositive attained scores are unranked; non-finite arithmetic makes only
that member's affected metric unavailable, with no partial score.

Why: preserve independent comparisons.
Code: `apps/mobile/src/groups/cow-scoring.ts`.
Code: server adapter in `apps/mobile/src/groups/cow-evaluation.ts`; public readers in `apps/mobile/src/groups/cow-wire.ts`.

### groups.cow-baseline · calculation · accepted

Improvement compares the weekly best with the pre-week lifetime best qualifying
group-shared 1RM, frozen from latest eligible source/dependency states accepted before start. Resolve removals before
filtering eligibility. Private history and late historical uploads or
corrections never supply this denominator. Both attained values must be
positive; otherwise improvement is unranked. Signed negative and zero
improvements rank normally, descending. Settings periods cannot shorten the
baseline.

Why: freeze the denominator.
Code: `apps/mobile/src/groups/cow-scoring.ts`.
Code: start checkpoint and retained baseline in `supabase/migrations/20261030062725_group_cow_publication.sql`.

### groups.cow-calendar · definition · accepted

CoW uses a validated group IANA zone, defaulted from its creator, with immutable
UTC Monday-to-Monday half-open bounds respecting DST. Zone changes never move
a published CoW. Admins schedule next week only, before start, with one
non-cancelled published CoW per group/week and no overlapping windows across
zone changes. Exercise/metric edits and cancellation are pre-start only.
Cancellation retains audit and releases the slot for replacement. Every current
member sees the saved group zone on group management; only owners/admins get
its setup entry there, through group Edit. CoW flows have no zone setup controls.

Why: share one competitive week.
Code: `supabase/migrations/20261029204606_group_cow_lifecycle.sql`; `apps/mobile/src/groups/api.ts`.

### groups.cow-participation · definition · accepted

All current members participate automatically on a roster fixed at start.
Midweek joins and rejoins wait for the next CoW. Leaving or removal ends
further contributions but preserves results already accepted while that
membership was active; rejoining cannot resume this week. Current group
authorization still controls reads, including former members' loss of access.

Why: preserve the starting field.
Code: `apps/mobile/src/groups/cow-scoring.ts` consumes the starting roster and first membership end.
Code: admission barrier in `supabase/migrations/20261030062725_group_cow_publication.sql`.

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

Why: sync latency cannot decide ties.
Code: `apps/mobile/src/groups/cow-scoring.ts`; receipt intake in `supabase/migrations/20261029205006_group_cow_intake.sql`.
Code: publication in `supabase/functions/group-eval/`.

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

Why: preserve outcomes and privacy.
Code: `apps/mobile/src/groups/cow-scoring.ts` classifies context availability.
Code: automatic publication and immutable results in `supabase/migrations/20261030062725_group_cow_publication.sql`.

### groups.kg-disclosure · definition · accepted

Co-members see a member's kg for an exercise unless the current setup hides
it, per group:

| Case | Decision |
| --- | --- |
| Group bodyweight calculations off | kg shows |
| A kg score on a group exercise that now counts bodyweight (board, history, CoW) | Hidden |
| Live links to the group's exercises | kg hidden when one of them has a positive bodyweight contribution |
| No live link | kg hidden when the member's own exercise has a positive contribution |
| No exercise definition | kg shows |
| Tombstoned links, past scores, events, CoW source references, a set's former exercise | Never count |

A member who re-points a link or moves a set chooses what that shows; hidden
kg reveals only that the exercise counts bodyweight.

Why: disclose by current setup.
Code: `group_competition_redacts_exercise` in `supabase/migrations/20261115160000_group_kg_disclosure_current_rule.sql`.
