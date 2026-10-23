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
| Member exercise's per-side/total entry mode changes after rollout | Ends affected certifications; switching back restores none |
| Certifications existing at rollout | Preserved with their original audits |
| Group target-mode, formula or private bodyweight preference/contribution/reading changes | Preserve unchanged witnesses |
| After it ends | Only a new certification re-certifies the set |

Why: one witness attests one performance.
Code: `supabase/migrations/20261008160000_group_competition_set_certification.sql`; `apps/mobile/src/groups/competition-session-records-view-model.ts`.


### groups.normalized-set-display · presentation · accepted

Normalized group sets show total external load and effective 1RM as `%BW`, and
Volume as `%BW·reps`, using bound group scores. Known zero stays numeric;
unavailable projections retain reps/effort. Never expose private inputs or mix
normalized Volume into absolute totals.

Why: private load display.
Code: `apps/mobile/src/groups/competition-session-view-model.ts`.
