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

Why: a witness watched a set being lifted, and every figure from that set is
equally true or untrue; certifying it metric by metric let one set be
half-certified, by different people.
Code: `group_competition_certify` and the witness-end trigger in `supabase/migrations/20261008160000_group_competition_set_certification.sql`; `setCertification` in `apps/mobile/src/groups/competition-session-records-view-model.ts`.
