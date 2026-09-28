# M28-T02 — Implement the simplified bodyweight contract

- Status: `planned`
- Depends on: `M28-T01-Define_simplified_bodyweight_contract`
- Milestone: `docs/plans/milestones/M28-simplify-bodyweight-ux-and-semantics.md`
- Areas: frontend, backend, cross-stack; UI impact: yes

## Objective

Implement the accepted M28 bodyweight contract as one coordinated cross-stack
change. Replace the old schema and semantics, preserve workout history and
dated readings, integrate private/group/coaching consumers, obtain explicit
human UI acceptance, and then run the complete locally selected gate suite.

This one task closes the combined acceptance cases in #392, #395, #396, #398
and #399; do not split it into five symptom patches.

## Scope

- In:
  - local and server migrations, Sync v2 wire changes and protocol cutover;
  - synced private preference and server-authoritative group preference;
  - personal/group contributions, seed defaults and kg-only conversion;
  - ordinary, personal-aware and strict group calculation boundaries;
  - Settings, bodyweight history, exercise editor, logger, records, history,
    Stats, completion/share and group administration/board behavior;
  - group evaluator, privacy, publication, records and certification handling;
  - connected-agent/coaching output and import/export alignment;
  - focused tests, native evidence, human UI review and final selected gates.
- Out:
  - unrelated UI restyling or group/coaching features;
  - exposing the calculation breakdown;
  - name-based exercise classification;
  - preserving removed fields or old behavior solely for legacy clients;
  - closing child issues before each acceptance case has evidence.

## Decided

Implement milestone decisions D1-D17 exactly. In particular:

- private and group preferences are independent and default off;
- preferences hide/ignore but never erase contributions or readings;
- personal missing bodyweight falls back to zero; group missing bodyweight
  yields no dependent score;
- all weight data and UI are kg-only;
- blank performed Weight canonicalizes to zero and valid zero metrics render 0;
- no session prompt/card/link exists and no UI says Added, External weight or
  Effective load;
- raw Top weight remains independent from derived 1RM/Volume;
- private bodyweight may support group calculation but may not leak through
  group payloads, caches, events, boards, record details or certifications;
- certification fingerprints calculation dependencies but does not claim that
  the certifier verified bodyweight; flag a simpler honest alternative during
  review if implementation evidence exposes one.

## Open — resolve with the user at session start

None. Re-read the merged T01 source-of-truth specs and check them against the
current `origin/main`. Ask only if a new conflict would materially change an
agreed D1-D17 decision.

## Implementation slices

Keep these as reviewable commits on one task branch and one PR; they are not
separate child-issue PRs.

1. Clean schema and migration
   - Add the synced private preference and group preference.
   - Rename personal/group coefficients to contributions.
   - Remove movement/loading, unit, external-mode and retired hydration fields.
   - Convert retained lb sets, planned values and readings to kg without display
     rounding; preserve sessions, sets, readings, IDs and clocks.
   - Default migrated preferences off while retaining contributions/readings.
   - Update import/export and Sync v2 protocol/capability boundaries.
2. Pure calculations and personal consumers
   - Separate ordinary, personal-aware and strict group missing-context policy.
   - Implement zero-load 1RM/Volume semantics and exact per-side handling.
   - Keep raw Weight records separate from derived 1RM and Volume.
   - Refresh all personal consumers after preference, contribution, reading,
     session-time and sync changes without rewriting raw sets.
3. Personal UI
   - Add the same-line Settings toggle and conditional `Manage weights` link.
   - Make reading entry/history kg-only.
   - Conditionally render the one contribution field in the exercise editor.
   - Remove session bodyweight cards/actions, unit selectors, extra fields,
     unavailable/incomplete copy caused by missing personal bodyweight, and all
     retired vocabulary.
   - Align logger, rows, records, History, Stats, completion and sharing.
4. Groups and coaching
   - Add admin group control and conditional group contributions.
   - Rebuild/publish calculations under group revisions without mixed rules.
   - Exclude strict missing-reading scores while retaining raw shared activity.
   - Keep private reading values and provenance out of every group-facing wire
     and cache; update internal invalidation/fingerprint dependencies.
   - Gate coaching metrics/bodyweight fields on the private preference.
5. Evidence and closeout
   - Replace retired unit/component/backend/native expectations.
   - Complete the human UI hold point before aggregate gates.
   - Verify every child issue explicitly and record evidence in the PR.

## Deliverables and acceptance

1. Private mode off gives every exercise ordinary Weight / 1RM / Volume math;
   missing contributions or readings cannot block logging.
2. Enabling private mode reveals preserved contributions and `Manage weights`;
   disabling/re-enabling repeatedly loses no data.
3. Exact seed contributions are 100% pull-up/chin-up/dip and 70% push-up; all
   other new exercises default to zero without name inference.
4. Personal positive-contribution math follows D5. Missing personal bodyweight
   falls back to zero and later reading changes recalculate history.
5. Blank Weight logs as zero; Volume and 1RM show numeric zero, reps/counts
   survive, and zero creates no record/ranking.
6. Personal editor contains no movement standard, loading method or unit
   selection. Ordinary screens contain no bodyweight prompt/card and no retired
   Added/External/Effective vocabulary.
7. All retained lb sets, planned values and readings migrate accurately to kg;
   workout history and readings remain readable after local and remote restore.
8. Group preference and contributions are admin-controlled, independent from
   personal settings, and survive off/on cycles.
9. Strict group calculation uses the group's contribution and member reading;
   missing reading yields no dependent score while raw shared sets remain.
10. Group-facing data never exposes private bodyweight value, date, identifier
    or fingerprint. Reading/input changes invalidate affected certification
    without implying that the certifier verified weight.
11. Coaching uses ordinary/no-bodyweight output while private mode is off and
    authorised bodyweight-aware output while it is on.
12. Specs modified by implementation details remain aligned with the merged T01
    contract; no code/test/spec outside `docs/plans/**` cites the milestone or
    task IDs.
13. The user explicitly accepts the implemented interaction/design direction
    before the aggregate closeout suite runs.
14. Every lane selected by final `./boga test for --diff origin/main...HEAD` is
    green, with evidence in the PR body.

## UX contract

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Toggle private mode | Settings → toggle on → inspect same row → toggle off/on repeatedly | `Manage weights` and contribution fields follow visibility; all values return unchanged | Offline toggle persists locally and syncs later; no destructive warning because nothing is deleted |
| Manage kg readings | Enabled Settings row → `Manage weights` → add/edit/delete dated kg reading | History updates and affected personal/group/coaching projections refresh | Invalid/future input remains editable; failed write is inline; no session-local entry path |
| Configure contribution | Private mode on → create/edit exercise → enter 0-100% | Saved contribution drives personal calculations; seeded defaults are visible/editable | Decimal/range validation is inline; hiding via toggle preserves input |
| Log ordinary set | Mode off or contribution 0 → enter or omit Weight → enter reps → confirm | Entered kg drives 1RM/Volume; blank becomes zero; set completes | Invalid numeric input cannot commit; missing bodyweight is irrelevant |
| Log bodyweight-aware set | Mode on + positive contribution → log set with an applicable reading | Silent D5 calculation produces Weight/1RM/Volume with ordinary labels | Missing reading uses personal zero fallback; logging remains unblocked and no warning/prompt appears |
| Review history | Change mode, contribution or dated reading → revisit records/history/Stats/completion | Derived 1RM/Volume reinterpret; raw Top weight and logged rows remain unchanged | Zero results are numeric and not records; refresh failure retains retry without fabricated data |
| Control group mode | Group admin → enable group mode → edit contribution → disable/re-enable | Group revision publishes coherent recalculation and retains contribution | Non-admin cannot edit; failed online write retains form; no mixed revision is shown |
| Score group performance | Member shares linked set; group mode/contribution positive | Valid private reading is used without disclosure; result can rank/certify | Missing reading yields no dependent score; ordinary/raw activity remains; recalculation invalidates stale certification |
| Use connected coach | Authorised coach reads metrics while private mode off, then on | Off returns ordinary/no-reading output; on returns allowed bodyweight-aware context | Missing reading follows personal zero policy; unauthorised access remains denied |

## Specs to update

Update the owning specs from T01 only when implementation settles a durable
detail not already expressed there. At minimum verify continued alignment of:

- `docs/specs/00-product.md`
- `docs/specs/03-technical-architecture.md`
- `docs/specs/05-data-model.md`
- `docs/specs/10-api-authn-authz-guidelines.md`
- `docs/specs/tech/bodyweight-load-contract.md`
- `docs/specs/tech/sync-v2-server-contract.md`
- `docs/specs/tech/groups-contract.md`
- `docs/specs/ui/design-targets/bodyweight.md`
- `docs/specs/ui/ux-rules.md`
- `docs/specs/ui/design-language.md`
- `docs/specs/ui/screen-map.md`
- `docs/specs/ui/components-catalog.md`
- `docs/specs/06-testing-strategy.md`
- `apps/mobile/scripts/import/BOGA_IMPORT_JSON_CONTRACT.md`
- `supabase/functions/agent-api/README.md`

## Test coverage

- Read `apps/mobile/app/__tests__/README.md` and every more-specific test
  directory README before editing tests there.
- Pure vectors: ordinary/on/off, contribution 0/decimal/100, total/per-side,
  kg-only, blank/zero, personal missing-reading fallback, strict group missing
  reading, overflow/invalid inputs and zero record exclusion.
- Migration/data: populated old schema; lb conversion; retained IDs/clocks,
  sessions, sets, planned values, readings and contributions; removed columns;
  private/group preference defaults and off/on persistence.
- Sync/backend: cross-device preference/contribution convergence, reinstall
  restore, protocol cutoff, group revision publication, no private-reading leak,
  strict missing score and certification invalidation.
- UI: same-row Settings composition at supported widths, conditional link/field,
  seed defaults, no retired fields/units/prompts/vocabulary, zero displays and
  repeated toggle cycles.
- Coaching/import: private preference gating, kg-only payloads and retained
  imported history under the new contract.
- Native: rewrite `ios-bodyweight` around ordinary logging, opt-in, kg reading,
  recalculation and preserved contribution; extend sync and two-user group flows
  only for cross-stack cases that Jest/backend tests cannot prove.

## Human UI gate

Do not run the final suggested aggregate suite until the user has exercised and
explicitly accepted the implemented UI.

1. Build the smallest usable integrated path.
2. Run focused calculation, migration and component tests needed to make the
   review build reliable; run the focused `ios-bodyweight` lane only when useful.
3. Present on device/simulator: private Settings row, weight history, personal
   exercise editor, ordinary/bodyweight-aware logger and records, group setting
   and group exercise editor. Include off/on/off/on persistence and missing
   reading states.
4. Incorporate feedback and repeat human review after any material UI change.
5. Only after explicit acceptance run `./boga test for --diff origin/main...HEAD`
   and every selected closeout lane.

## Gates

Expected from `./boga test for` (the command, not this list, is authoritative):

- `./boga test fast`
- `./boga test backend`
- `./boga test frontend-ui`
- `./boga test ios-sync-e2e`
- `./boga test ios-groups-e2e`
- `./boga test groups-leaderboards`
- `./boga test ios-bodyweight`
- `./boga test meta-tests` when Maestro flows/fixtures change
- `./boga test mcp-smoke` only if the MCP service contract/code changes
- `./boga sweep --ref origin/<branch>` if the final `test for` output recommends
  the large/shared-UI backstop

`frontend-ui` contains `ios-bodyweight`; aggregate gates may subsume named lanes,
but the final PR Tests table must list every selected lane with its actual result
and evidence. After review, run `/code-review` on the branch diff and add
`/security-review` because the task changes RLS/API/privacy boundaries.
