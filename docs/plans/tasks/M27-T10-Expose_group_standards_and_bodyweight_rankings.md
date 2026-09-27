---
task_id: M27-T10-Expose_group_standards_and_bodyweight_rankings
milestone_id: M27
status: in_progress
ui_impact: "yes"
areas: "frontend|cross-stack"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test backend; ./boga test frontend"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/ui/ux-rules.md, docs/specs/ui/screen-map.md, docs/specs/ui/navigation-contract.md, docs/specs/ui/components-catalog.md"
---

# M27-T10 — Expose group standards and bodyweight rankings

- Status: `in_progress`
- Depends on: M27-T07, M27-T09.
- Milestone spec: `docs/plans/milestones/M27-bodyweight-load-and-group-comparisons.md`
- Governing decisions: D7–D9.

## Objective and scope

Make group comparison rules, score meaning and input provenance visible across
group exercise setup, linking, podiums, boards and certification. Read AGENTS.md,
specs 02/03/08/09, groups/bodyweight contracts, UI index/policy and T01's target.
Refresh routes/components and HEAD; read test-directory READMEs before edits.

## Deliverables and acceptance

1. Owners/admins edit coefficient, movement/loading standard and default metric
   on the group exercise. Everyone can read the standard. Explain history-wide
   recalculation before a rules edit; a different movement is a new exercise.
   Respect existing online-only group writes and role permissions.
2. Linking shows personal versus group semantics and warns/refuses incompatible
   movements as defined by T08. Never overwrite personal configuration merely
   because it links. Offline member linking remains supported as today.
3. Bodyweight podiums/boards offer Reps, Relative strength and Absolute strength
   with explicit reps/×BW/kg units and Certified/All. Defaults: unweighted
   standard push-ups → Reps; weighted pull-ups/dips → Relative strength.
   Conventional Weight/1RM boards retain their behaviour.
4. Record detail shows raw added/assisted amount, kg and %BW when available,
   session B/source/provenance, group coefficient/rule revision and score basis.
   Certification reveals what is being attested, including estimated B.
5. Update record/void/link cards, history, cached/offline displays, friend session
   metrics and accessibility text for all metrics. Rules recalculation has its
   own explanation, not a spurious new-performance celebration.
6. Missing B offers eligible reps results and explains unavailable strength;
   rebuilding/archived/former-version states follow T08 without mixed rankings.

## UX Contract

Target: T01's bodyweight brief, using existing group forms, boards and record sheet.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Set group standard | Admin opens exercise → edits rule/default → reviews impact → saves | Members see the same version and updated scores | Offline/role failure preserves form and states nothing changed |
| Link exercise | Member opens link flow → compares standards → links compatible movement | Group evaluates their raw sets without changing personal settings | Incompatible variant explains required separate exercise |
| Compare members | Open podium → switch board and Certified/All → inspect row | Metric/units/default and reason for score are clear | Missing B, empty certified board and rebuilding are actionable |
| Certify performance | Open record sheet → inspect saved B/provenance and load → certify | Attested inputs match score and updated scope | Estimated B is explicit; edited/voided data cannot retain certification |

Reuse existing group recipes and UI tokens; no raw styling exceptions proposed.
Capture each board, relative/absolute reversal, missing/estimated B, offline,
permission/error, rules change and certification states at target sizes. Attach
render comparisons plus happy/error path interaction evidence to the PR.

## Verification and closeout

Run component/view-model tests and two-user flows covering different weights,
group coefficient authority, backfill and correction invalidation. Run
`./boga test fast`, `./boga test backend`, `./boga test frontend`; confirm
`ios-groups-e2e` is included and resolve additional diff requirements with
`./boga test for`. Graduate UX/group contracts, attach evidence, mark the
milestone entry complete and delete this card when shipped.


## Execution checkpoint (2026-09-27)

Integrated the reviewed group rule form with revision-bound preview and stale
edit preservation; versioned catalogue/archive calls; compatibility explanations
and guarded Add as new; metric podiums, full boards, revision history and frozen
legacy scores; saved-B/provenance record details and metric-specific board
certification. Groups and Today now read the v2 stream and preserve units and
original rule revisions in event presentation. Personal shared-session metrics
remain explicitly personal and show incomplete volume.

Full fast passed: 184 suites / 2,214 mobile tests, plus backend fast, metadata,
consent and MCP checks. Log: `/tmp/boga-m27-comparison-ui-fast-2.log`.
Full backend passed: `/tmp/boga-m27-group-integration-backend-3.log`.
Stream certification now uses current per-metric context and the shared record
sheet, with raw/provenance display, metric selection and stale-read protection.
Frontend fast passed 184 suites / 2,216 tests; full backend passed, including
real SQL stream decoding, estimated attestation and equal-score provenance
correction. Logs: `/tmp/boga-m27-stream-cert-fast-frontend-2.log` and
`/tmp/boga-m27-stream-cert-backend-final.log`.

The existing two-user Maestro flow now targets generic conventional boards and
separate Weight/1RM attestations while retaining its legacy unlink assertions.
Its new M27 sequence covers 60/90 kg relative/absolute reversal, personal versus
group coefficient authority, missing-B reps, estimated-B certification, an
admin's rules preview/rebuild and corrected-B invalidation. Syntax and metadata
checks pass (`/tmp/boga-m27-expanded-maestro-meta.log`); the full frontend run
is underway (`/tmp/boga-m27-comparisons-frontend.log`). Native interaction and
three-size visual acceptance remain unverified. No shipment claim.


Follow-up verification: a regression reproduced an ended certification being
restored when connectivity changed after a successful write. The sheet now
retains the latest server end state and follows a replacement attestation on
unchanged inputs. Full fast passed 184 suites / 2,218 tests, including all
backend/repository/consent/MCP fast lanes (`/tmp/boga-m27-cert-refresh-fast.log`).
The first full frontend attempt passed smoke, data smoke, session completion
and Settings wipe. Stats exposed a stale blank-as-invalid fixture; it now uses
malformed text while preserving the 15-set assertion. Catalogue stopped in the
dev-client launcher; its flow now establishes app readiness before fixture
setup. Both fixes still require the native rerun. The dedicated group lane is
running at `/tmp/boga-m27-comparison-groups.log`; no device success is claimed.
