# M27-T10 — Expose group percentage rules and rankings

- Status: `planned` (re-scoped 2026-10-04)
- Depends on: M27-T09 (completed)
- Milestone: [M27 — Bodyweight load and group comparisons](../milestones/M27-bodyweight-load-and-group-comparisons.md)
- Workstream: [#420](https://github.com/Brotherhood-of-Ghisa/BOGA3/issues/420)
- Areas: frontend; UI impact: yes

## Objective and scope

Present T08/T09's Volume/1RM units, group standards and certification lifecycle
across existing group flows. This restores the UI task scope: the consolidated
card accidentally duplicated T09. Milestone D2–D10 govern; do not restore the
obsolete three-board, public-B/provenance or absolute bodyweight alternative.

## Deliverables and acceptance

1. Owners/admins edit group contribution, load mode, default metric and the
   retained group On/Off switch. Members read the same standard. Explain coherent
   recalculation and unchanged witness retention before effective rule changes;
   c=0 preference toggles do not promise a rebuild. Linking preserves personal
   configuration, movement compatibility and current offline-link behavior.
2. Boards/podiums offer Volume and 1RM with Certified/All and T08's explicit
   units/defaults. Off and c=0 show ordinary kg·reps/kg; On with c>0 shows the
   accepted normalized results. Apply units to rows, accessibility, detail,
   history, events and caches; never relabel historic kg or fall back to kg On.
3. Record detail, certification actions and View full session consume T09's safe
   projections. Hide enabled bodyweight raw/absolute load, volume and audit
   counterparts, all private reading identity/date/value/provenance and digests.
   Keep permitted public set context such as reps/date/identity.
4. Apply D4: dependent correction ends that projection, while raw legacy witness
   remains active; restore never reopens ended rows. Rules-only ineligibility
   retains the active witness and restores its entry on eligibility. Use generic
   “Certification ended”/“Score unavailable” copy without exposing private cause.
   Preserve witness/time and original audit server-side through unit migration.
5. Retire incompatible old caches and fail safely for unsupported versions/units.
   Cover stale writes, offline/error, rebuilding, archived/former-member and
   account-switch states using existing group recipes and role boundaries.
   Rules recalculation is not a newly performed PR or a celebration.

## UX contract and target

Before implementation, pin a repo-native brief plus reference screenshots under
`docs/specs/ui/ai-design-policy.md`, using the current group design target and
existing UI tokens/recipes. State any material target change explicitly.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Change group rules | Admin opens settings/comparison → edits → reviews impact → saves | Coherent recalculation preserves witnessed set | Offline/role/stale failure retains input and says nothing changed; c=0 toggle stays ready |
| Link movement | Member compares group/personal standards → links compatible movement | Group evaluates raw sets without changing personal settings | Incompatible movement needs separate comparison; existing offline path remains |
| Compare members | Open podium → choose Volume/1RM and scope → inspect record/full session | Correct units and safe public context everywhere | Missing score is generic; rebuilding/history/offline never mixes units or leaks cached kg |
| Witness performance | Inspect safe set detail → certify or authorized removal | Exact active witness/state and score refreshed | Correction ends dependent projection; restore never reopens; failed write has no success |

Render relevant states in the running app at target sizes and compare with the
pinned brief/screenshots. Record intentional differences, accessibility and happy/
error path evidence in the PR. Automated captures are not T14 human acceptance.

## Verification and closeout

Read test-directory READMEs. Add component/view-model/decoder/cache Jest coverage
for mode/category units, safe detail/full-session, lifecycle copy and offline/
error/permission states. Run `./boga test for`; expected lanes are fast,
frontend-ui and ios-groups-e2e, plus required quality gates. Reuse existing flows;
new Maestro scenarios require justification and approval. Graduate shipped
UI/group contracts, delete this card and complete its milestone row in the PR.
T14 owns human acceptance, combined gates and activation/closeout.
