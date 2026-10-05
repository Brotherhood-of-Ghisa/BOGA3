# Group Volume and 1RM competitions

**Target pinned 2026-10-05.** Repo-native brief plus selected reference captures.
The operator's accepted percentage/privacy behavior governs calculation and
content; the previously accepted [Groups target](groups.md) governs layout,
tokens and interaction recipes. Integrated human flow acceptance remains
required before workstream closeout; automated captures do not provide it.

## Target and resolved differences

Use the existing group form, podium, dense board rows, history, record sheet,
stream cards and read-only session structure. This target deliberately replaces
Groups' Weight toggle, unitless ranking figures and raw-load record context with
Volume/1RM, explicit units and safe server projections. It also supersedes the
older group-only raw-Weight/1RM examples in [bodyweight](bodyweight.md); personal
workout and reading surfaces retain that target.

Behavior authority: [competition contract](../../tech/group-competition-contract.md).
Appearance authority: [design language](../design-language.md),
[UI rules](../ux-rules.md) and [design policy](../ai-design-policy.md).

## Brief

- Keep existing cards, fields, sheets, hairlines and control hierarchy. Owners
  and admins edit the group switch, contribution, load entry and default metric;
  members read the same standard. The contribution field retains its value Off.
- Before an effective scoring edit, show a compact review: the whole comparison
  recalculates coherently, the witnessed unchanged set keeps its certification,
  and personal settings stay unchanged. Zero-contribution switch changes and
  default-view/name edits must not promise a rebuild.
- Boards offer `Volume` / `1RM` and `Certified` / `All`. State the current unit
  (`kg·reps`, `kg`, `%BW·reps`, `%BW`) in values, detail and accessibility.
  The opening metric follows the comparison default. Retired revision score
  snapshots are unavailable through the safe reader; their unit-bearing history
  remains readable. The Scores tab only renders the current revision. Rebuilding has no stale
  rows; archived comparisons are read-only. History retains its original unit.
- Normalized records show permitted reps, identity, date and generic witness
  state. Full-session cards keep readable reps and effort while omitting the
  restricted loads and absolute totals. Ordinary unrelated context can retain
  its permitted kg. No public surface shows a private reading or audit digest.
- Use `Score unavailable` and `Certification ended` without a private cause.
  Keep inline write errors, input retention, role checks and removal confirmation.
  Pending/unsupported service contracts fail safely; generation-5 cached payloads
  are validated, group scoped and discarded on incompatible policy or access.
  Recalculation has no new-record celebration.

## Selected reference states

| Capture | Device/state | Recipe retained |
| --- | --- | --- |
| [Board](bodyweight/board-reference.png) | iPhone, 402×874pt (1206×2622px); All · 1RM | Two selectors, dense rank/member/value/date card |
| [Editor](group-competitions/editor-reference.png) | iPhone, 402×874pt (1206×2622px); custom Add exercise, 2026-10-05 | Card fields, load entry, default view, one primary |
| [Session](bodyweight/session-reference.png) | iPhone, 402×874pt (1206×2622px); read-only shared session | Facts and exercise-card hierarchy |
| [Groups states](groups.md) | Previously accepted group gallery | Podium, stream, record sheet and state/notice recipes |

## Runtime comparison

Render at 375×667pt, 402×874pt and 440×956pt. Cover rules review, retained Off
contribution, ordinary and normalized boards/podiums, safe record/full session,
rebuilding, absent/ended scores and offline/error/role states. Keep runtime
captures under the ignored Maestro artifact tree and link evidence in the PR.
No horizontal overflow, truncated units or inaccessible actions may ship.
