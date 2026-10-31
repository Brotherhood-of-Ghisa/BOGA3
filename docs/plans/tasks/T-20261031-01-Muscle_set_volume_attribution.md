# T-20261031-01 — Independent muscle Sets and Volume attribution

- Status: `in_progress`
- Depends on: none
- Milestone: none
- Areas: cross-stack; UI impact: yes
- Planning baseline: `origin/main` at `5e2eb0b9318a8bfc9ee01c7dad3002f70edfc1c1`.
- Execution: task protocol. The operator requested this card on a dedicated
  pushed branch, followed by delegated implementation, repeated review/fixes,
  and a PR only after the reviewer is satisfied. Execute on this branch; a
  separate planning PR/merge is not required for this task. Do not merge the
  implementation PR without the operator's explicit approval.

## Objective

Separate muscle set counting from muscle Volume allocation, with independent
account settings applying to every muscle figure. Default to direct sets and
Volume including secondary involvement. Allocate Volume from the complete
exercise mapping before any filters or muscle merging, preserving original
roles and the existing load/Volume base.

## Scope

- In: shared muscle derivation; Settings and all consumer filters; account
  preference persistence/sync; Progress List/3D/contributors; muscle history
  Timeline/Grid/Weekly/references/drill-downs; Today/Recovery/targets; live and
  completed-session muscle figures/comparisons; muscle figures in share outputs
  or group views where present; coaching API/MCP output and documentation;
  editor compatibility, tests and owning product/spec updates.
- Out: changing exercise or physical-session set/Volume totals, load
  normalization, bodyweight math, effort eligibility, exercise records/1RM,
  group competition scoring, target values, unrelated redesign or restyling.
  Keep personal effort choices and fixed coaching effort eligibility distinct.

## Freshness and editor reconciliation sub-task

The original discussion inspected an older local checkout (`64b4bdea`) whose
editor model used one `primaryMuscleGroupId`. Fresh main already has
`primaryMuscleGroupIds`, a multi-select UI and role validation. Co-primary
support shipped in `675f6c7d` (#1032); `672808f1` (#1052) subsequently changed
allocation/display rules. The operator correctly identified existing
multi-primary support: do not add it again or regress it.

1. Recheck current main and the editor model, form, screen and tests before
   implementation. Record any further drift in the implementation report.
2. Verify every existing primary and secondary survives open/save, unrelated
   edits, duplication, role changes and Broad/Detailed changes; hidden mappings
   remain preserved. Fix actual inconsistencies found in this sub-task.
3. Keep roles and existing persisted mapping weights compatible. New Volume
   shares are read-time derivations, never written back as mapping roles or
   weights. Strongest-role presentation must not erase raw role provenance
   needed by the independent settings or mixed-role merged Volume.

Current main splits primary Sets and Volume by primary cardinality, gives
every secondary its own half contribution, and suppresses secondary work
beside primary work after merging. This task deliberately replaces those
rules with the independently defined rules below; do not share one allocation
factor between Sets and Volume.

## Decided — do not reopen without the operator

### Independent settings and scope

| Account setting | Default | ON | OFF |
| --- | --- | --- | --- |
| Sets: Primary only | ON | Each primary muscle gets 1 working set; secondary gets 0 | Each primary gets 1; secondary gets 0.5 |
| Volume: Primary only | OFF | Include allocated primary Volume only | Include allocated primary and secondary Volume |

Both settings govern every muscle figure in scope, including session summaries,
Today and coaching. Any retained visit overrides must be metric-specific and
propagate through the relevant history/drill-down navigation; they must never
silently change the other metric. Saved defaults are account-scoped and synced,
using the existing preferences mechanism. The agreed upgrade policy is to
preserve an existing account's effective old secondary-counting choice for
Sets only. Legacy count-secondary ON maps to Sets Primary only OFF; legacy
OFF maps to Sets Primary only ON. Initialize the newly introduced Volume
Primary only to its default OFF for both existing and new accounts, independently
of the legacy choice. Preserve an explicitly saved new Volume choice thereafter;
adoption/retry/another device must not reset it. New accounts start with Sets
Primary only ON and Volume Primary only OFF. Distinguish existing-account
adoption from new-account initialization; targets remain unchanged.
Primary-only Sets totals are whole;
the other mode intentionally allows half-steps. Do not round during derivation.
Preserve existing shared display policies unless the new controls require a
specific, documented adjustment; no unrelated formatting redesign.

### Volume allocation

Let V be an eligible set's existing calculated muscle-volume base. Its
calculation does not change: retain total/per-side and bodyweight handling
(100 per side corresponds to 200 total). This task changes attribution only.

1. Deduplicate mappings to each raw anatomy entry, keeping the strongest role.
2. Over the complete exercise mapping, let P be distinct primary entries and
   S distinct secondary entries. A primary receives V/P. A secondary receives
   0.5*V/S. Stabilizer/null roles receive zero. Stored granular weights do not
   redefine these role rules.
3. Allocate before role/visibility filters and Broad/Custom merging. Disabled,
   hidden, unselected or merged entries do not change P or S. Filtering drops
   shares without redistribution. With no primary or secondary entries, that
   role's pool is unused: never divide by zero or transfer its pool.
4. Filter original contributions by the Volume setting, then sum surviving
   shares into reported muscles. A merged primary+secondary muscle retains
   both Volume contributions when secondary Volume is included. Its strongest
   role may label the result but must not suppress secondary Volume.
5. With both roles present, the pools assign 150% of V. This is an attribution
   convention; do not normalize it back to 100%. A lone secondary can receive
   more than each of three primaries; do not add an unagreed ordering cap.

### Sets and aggregation

Every qualifying physical set gives each distinct primary muscle 1, regardless
of P. Multiple primaries intentionally overlap; do not divide Sets by P.
Secondary credit is independently 0 or 0.5 according to the Sets setting,
never divided by S. For each reported muscle, deduplicate the physical set at
its strongest surviving role:

| Raw entries merged into one reported muscle | Primary-only Sets | Sets including secondary |
| --- | --- | --- |
| Two primary entries | 1 | 1 |
| Two secondary entries | 0 | 0.5 |
| One primary + one secondary | 1 | 1 |

Family set buckets must also deduplicate overlapping physical sets at their
strongest role; never manufacture a global set count by summing muscles.
Whole-session/exercise totals remain physical working-set counts.

### Targets, Recovery and history

- Target values, overrides and preset-specific target configurations stay
  unchanged. No rescaling, recalibration or extra target modes.
- Secondary-only work showing zero in primary-only Recovery is accepted;
  update its ordering, target grading and coaching projections consistently.
- A muscle may have zero Sets and positive Volume. Include rows, days, weeks
  and contributors according to the selected metric; zero Sets cannot imply
  empty Volume. Keep existing working-set and Volume eligibility independent.
- Current metadata and settings reinterpret history without rewriting raw
  workouts. Compute both comparison periods and their references under the
  same rules. Preserve unrelated baseline eligibility and record rules.

## Numerical acceptance examples

One qualifying set, V=1200; all listed anatomy entries tracked:

| Raw mappings | Detailed Volume (secondary included) | Broad Volume after allocation |
| --- | --- | --- |
| Lats P, Upper Back P, Rear Delts P, Biceps S | 400, 400, 400, 600 | Back 800; Rear Delts 400; Biceps 600 |
| Lats P, Upper Back S, Biceps S | 1200, 300, 300 | Back 1500; Biceps 300 |

For the second row, Volume primary-only gives Back 1200 and Biceps 0. Sets
primary-only gives Back 1 and Biceps 0; including secondary gives Back 1 and
Biceps 0.5. Volume primary-only must not change those Sets. Disabling Upper
Back hides its 300 without increasing Biceps above 300. Test both settings in
all four combinations, no-role pools, duplicates and non-finite/zero Volume.

## Deliverables and acceptance

1. Separate shared calculation paths for set credit and Volume shares with
   source-role provenance, stable denominators and correct merged totals.
2. Two independent persisted/synced settings, explicit defaults and coverage
   for adoption, sign-out/account isolation, wipe/restore and cross-device
   round trips. Retire the coupled flag without silently applying it to both
   new metrics. Complete any required typed client/server schema evolution.
3. Audit every muscle consumer named in Scope; use shared derivations, preserve
   route/filter scope and correct metric-specific empty states. Exercise and
   physical-session totals/records remain unchanged.
4. Complete the editor reconciliation sub-task and regression coverage using
   existing multiple-primary support.
5. Update coaching's metric revision from the latest value on main (planning
   baseline is `working_sets_v9`), its pins, response setting metadata and MCP
   descriptions. A settings contract change follows the sync/server contract;
   do not bump unrelated group or exercise-facts versions automatically.
6. Update owning product facts/specs in the implementation PR, report the
   changed fact IDs and review verdict, and delete this card when it ships.
   No production code/test/spec may reference this card's path or ID.

## Open — resolve during task-level design

- Migration implementation for the old single `progressCountSecondary` /
  `count_secondary_muscles` preference. The preservation policy above is fixed;
  verify legacy local/default/server adoption cases and cross-device upgrade
  ordering without treating an existing account as a new one.
- Technical handling of retained visit controls and legacy route/API names.
  Preserve independent choices and total consumer scope with minimal
  compatibility handling; the saved switches' placement and copy below are fixed.
- Any actual drift uncovered against newer main; report it before building.

## UX contract and design target

Repo-native brief, explicitly specified by the operator: at the existing
Count secondary sets control location, replace it with two adjacent switches
labelled exactly `Sets: Primary only` and `Volume: Primary only`, in that
order. Reuse the existing control/card placement, form grammar and UI tokens;
do not move the controls into a new settings section or redesign their layout.
Sets defaults ON for new accounts and preserves the legacy choice for existing
accounts; Volume defaults OFF for both. Retain the existing multi-primary editor UI.
Before significant UI implementation capture current reference screenshots
and pin the concrete control design against this brief; capture and compare
finished states at small and large supported widths. No general restyle.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Independent choices | Change one Primary only control; inspect Sets and Volume across consumers, reopen and sync | Only that metric changes; the choice survives restart and reaches another device | Unchanged setting and target values survive adoption, account switches and retry |
| Inspect muscle work | Switch Detailed/Broad; select a muscle and open each history/drill-down view | Allocation examples reconcile; filtering never reallocates; settings propagate | Zero Sets with positive Volume remains available in Volume views |
| Edit multiple primaries | Open an existing multi-primary exercise; save unrelated edits, duplicate, then deliberately change a role | Existing roles survive and only intended edits change derived history | Hidden entries remain preserved; invalid role selections keep validation |
| Review Recovery | Open Today after secondary-only work under primary-only Sets | Zero direct sets, existing target values and corresponding coaching figures agree | No attempt to credit indirect work or rescale targets |

## Sources and owning docs

- Always load AGENTS.md's mandatory sources; for calculation changes load
  `docs/product/muscle.md`, `docs/product/set.md`, `docs/product/comparison.md`
  and `docs/specs/tech/training-metrics-contract.md`.
- For preference schema/sync work load `docs/specs/05-data-model.md` and
  `docs/specs/tech/sync-v2-server-contract.md`; for coaching API work load
  `docs/specs/10-api-authn-authz-guidelines.md` and `supabase/README.md`.
- For publication/versioning load `docs/procedures/rule-upgrade.md`; for fact
  updates load `docs/procedures/product-facts-authoring.md`. Product changes:
  `muscle.set-count`, `muscle.secondary-filter`, `muscle.report-groups`, and
  relevant presentation wording in `muscle.no-breakdown`; preserve the values
  and unrelated behavior of `muscle.weekly-targets` and `muscle.untracked`.
- For UI work load `docs/specs/08-ux-delivery-standard.md` and
  `docs/specs/ui/README.md` / `docs/specs/ui/ai-design-policy.md`; update owning
  screen/navigation rules where settings, copy or route semantics change.
- Implementation entrypoints: `apps/mobile/src/data/muscle-analytics.ts`,
  `apps/mobile/src/data/stats.ts`, `apps/mobile/src/data/progress-comparisons.ts`,
  `apps/mobile/src/session-insights/`, `apps/mobile/src/today-plan/`,
  `apps/mobile/src/preferences/`, `apps/mobile/src/exercise-catalog/editor-model.ts`,
  `apps/mobile/components/exercise-catalog/`,
  `supabase/functions/agent-api/training-status.ts`,
  `services/boga-mcp/src/tools.ts`.

## Gates and review

The executing agent reads each test directory's README before editing tests.
Cover the formula/mode matrix, before/after merging examples, source identity
deduplication, hidden mappings, unchanged load/eligibility, defaults/migration,
full consumer parity, navigation and editor role round trips in Jest.

Run `./boga test for` for the finished diff and agree lanes with a separate
reviewer per the task protocol. Expected: `./boga test fast`; `backend` for
coaching/schema changes; `ios-sync-e2e` for synced-settings work on macOS;
the smallest relevant existing frontend/UI Maestro lanes; `mcp-smoke` if MCP
contracts change. Run `jest-coverage`, `complexity` and `dependencies` before
the PR. No new Maestro flow without a written reason Jest cannot prove it.
Do not claim an unavailable gate without `./boga doctor` and bootstrap repair.

The parent agent reviews the implementation and sends issues back until
satisfied. Obtain independent code and product reviews, fix material findings,
rerun affected gates and review again before opening the PR. Put evidence and
lane agreement in its body; preserve truthful AI attribution. Follow the
worktree/DB lifecycle, stop the stack when the PR opens, and retain the worktree
until explicit merge approval and post-merge cleanup.
