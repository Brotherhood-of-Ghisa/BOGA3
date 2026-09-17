---
task_id: M25-T11-E2E_and_closeout
milestone_id: "M25"
status: planned
ui_impact: "no"
areas: "frontend|docs"
runtimes: "node|expo|maestro|supabase"
gates_fast: "./boga test fast"
gates_slow: "./boga test ios-groups-e2e (+ whatever ./boga test for --diff origin/main prints)"
docs_touched: "docs/specs/tech/groups-contract.md, docs/specs/README.md, docs/specs/02-quality-and-test-gates.md (only if a row is stale), docs/brainstorms/2026-09-10-group-activity-stream.md (status line); deletes docs/plans/milestones/M25-group-exercises-and-leaderboards.md, docs/plans/group-exercises-and-leaderboards.md, docs/plans/group-exercises-tech-design.md, docs/plans/tasks/M25-T04-T11-later_cards.md, this card"
---

# M25-T11 — Two-user e2e extension and milestone closeout

## Task metadata

- Task ID: `M25-T11-E2E_and_closeout`
- Status: `planned`
- Depends on: `M25-T07` (PR #292, merged), `M25-T10` (PR #300, merged)
- All other M25 cards merged: T01 #287, T02 #285, T03 #286, T04 #291,
  T05 #294, T06 #297, T08 #290, T09 #296
- Unblocks: nothing. M25 is closed when this merges.
- Open elsewhere: the four-tab navigation PR #295 (M26) is **not merged** at
  card time. The extension only uses `boga3://group/<id>` deep links,
  group-screen segments, and group-route testIDs (no tab-bar taps), so no
  rebase is expected. If #295 lands first and steps 1–3 (the Groups tab
  entry) move, T11 rebases and follows #295's flow changes. It does not
  change them.

## Parent references

- Milestone: `docs/plans/milestones/M25-group-exercises-and-leaderboards.md`
- Product: `docs/plans/group-exercises-and-leaderboards.md` (P1–P19,
  D1–D17, E0–E3)
- Design: `docs/plans/group-exercises-tech-design.md` §8 (the e2e extension
  was decided there), §9 (T1–T9), §10 (specs to update)
- Contract: `docs/specs/tech/groups-contract.md` §2.11 (record attribution:
  a set created after its link is a record, not a link effect), §2.12, §4.2
  (`record` item, key = event id), §4.5, §4.6, §6.3 (M25-T08/T09/T10
  as-built), §8 (flow as-built through T10)
- Testing: `docs/specs/11-maestro-runtime-and-testing-conventions.md`
  (fixture users, waits), `apps/mobile/README-maestro.md`,
  `docs/specs/06-testing-strategy.md`
- As-built inputs: `apps/mobile/.maestro/flows/groups-two-user-stream.yaml`
  (steps 7b, 8b), `apps/mobile/.maestro/scripts/groups-counterparty.js`
  (`link-board`), `supabase/scripts/groups-fixture-reset.sh`,
  `components/groups/{stream-record-card,stream-session-card,record-set-sheet,group-leaderboards-page,group-board-row}.tsx`,
  `src/groups/{stream,board,record-set}-view-model.ts`

## Objective

1. **E2E.** Prove on the simulator, against the real evaluator, the one M25
   path that no lane covers end to end: a member logs a new best on a linked
   exercise → a record card appears in the stream → another member certifies
   it on device → the Certified boards and podium show it.
2. **Closeout.** Confirm every durable M25 decision is in `docs/specs/**`,
   fill the gaps, and delete the milestone, both plan docs, and the stub card
   file.

## Accepted design target

None. No app UI changes. The flow asserts the M25-T10 UI as built.

## Scope

### A. Counterparty script (`groups-counterparty.js`)

Two new steps. No existing step changes.

1. **`push-record`** (after `link-board`). One `sync_push` of a **new,
   completed** session. It starts at `max(now, groupsJoinedAtMs + 1 s)`,
   lasts 45 min, and uses its own ids (`<sessionId>-record…`). It holds one
   session exercise on the already-linked definition
   `<groupsSessionId>-def-bench` ("Bench Press", total load) and one set of
   **110 kg × 5**.
   - Its `created_at` is after the link's `updated_at`, so §2.11 step 5
     attributes a **record**, not a link effect. Converted ×0.5 to the
     per-side Prowler Push, that is 55 kg × 5. It beats 51.25 kg on Weight
     and e1RM, and user_d is the only lifter, so both boards carry
     `group_record`.
   - **Evaluator wait.** Poll `group_stream` (limit 50) until it returns a
     `record` item with `set_id` = the new set and `provisional: false`. The
     deadline is 90 s with a 3000-poll cap, exactly like `link-board`
     (runScript has no sleep), and the step fails loud on timeout.
   - Assert the item: `weight_kg` 55, `reps` 5, `load_factor` 0.5, boards
     `weight` and `e1rm`, both `group_record: true`, and `certified: false`.
   - Outputs: `output.groupsRecordKey` (the item key, for testIDs),
     `output.groupsRecordSessionCardKey` (`<user_d>:<record session>`), and
     `output.groupsRecordSetId`.
   - Log `GROUPS_E2E_LATENCY record sync_push->record item: <ms> (<polls>
     polls)`.
2. **`await-certified`** (after the device certifies). Poll `group_board(p_metric
   'e1rm', p_certified true)` until row 1 is user_d with `set_id` =
   `groupsRecordSetId` (same 90 s deadline and cap, fail loud). This is the
   device-certify → pg_net kick → apply latency.
   - It also asserts `certification.certified_by.user_id` is not user_d,
     i.e. the certification came from the device user.
   - Log `GROUPS_E2E_LATENCY certify->certified board: <ms>`.
   - The script has no device-side timestamp, so the latency is measured
     from the step's start. It includes Maestro's steps between tap and
     script. The log line says so.

### B. Device flow (`groups-two-user-stream.yaml`)

**New step 7c** goes after 7b's History (still before step 8, because a
former member's set cannot be certified, §4.6 step 5):

1. `runScript push-record`. Then `openLink boga3://group/<id>`, wait for
   `group-screen-stream-list`, pull-to-refresh once (the flow's existing
   gesture), and `extendedWaitUntil` the card
   `group-stream-record-card-${output.groupsRecordKey}` (15 s). Because the
   script already waited for the evaluator, the device wait covers only the
   read.
2. Assert the card:
   - `-title` = `<user_d> — group record`;
   - `-value` matches `Prowler Push.*55 kg × 5 · e1RM .* kg`;
   - `-status` = `○ Not certified yet`;
   - `-certify` is visible.
   - The new session's card `group-stream-session-card-${output.groupsRecordSessionCardKey}-records`
     reads `1 record`.
   - Screenshot `groups-07c-1-record-card`.
3. **Certify inline:** tap `…-certify`. Wait (15 s) for `…-notice` =
   `Certified\. Certified boards update in a few seconds\.` and for `…-status`
   = `✓ Certified by you` (read live after the host re-read), then
   `assertNotVisible …-certify`. Screenshot `groups-07c-2-certified-card`.
4. `runScript await-certified`, so the Certified entry exists server-side
   before any board read.
5. **Podium:** tap `group-screen-segment-leaderboards` and `extendedWaitUntil`
   (20 s, since the podium page refreshes cache-first when its segment
   opens) the card label `Prowler Push, Certified · e1RM, 1st <user_d> .* kg
   .*` (regex). Screenshot `groups-07c-3-podium-certified`.
6. **Certified board:** tap the card. Wait for row 1's label `1st, <user_d>,
   .* kg e1RM, 55 kg × 5, .*` (no certified mark on Certified). Tap
   `group-board-metric-weight` and wait for `1st, <user_d>, 55 kg × 5, .*`.
   Screenshot `groups-07c-4-board-certified-weight`.
7. **Certified history:** tap `group-board-history-button` and wait for
   `.*, <user_d> took #1 · 55 kg \(certified by you\)`. Screenshot
   `groups-07c-5-history-certified`.
8. **All board row detail:** deep-link
   `boga3://group/<id>/leaderboards/<exerciseId>?metric=weight&scope=all`,
   then:
   - wait for `1st, <user_d>, 55 kg × 5, .*, certified`;
   - open the row and assert `group-record-sheet-status` matches `✓
     Certified by you · .*`;
   - `group-record-sheet-withdraw` is visible (`Remove my certification`) and
     `group-record-sheet-certify` is not;
   - close without withdrawing.
   - Screenshot `groups-07c-6-row-detail-certified`.

**Step 8b changes** (the existing former-member assertions move to the new
best):

- The All · Weight row becomes `1st, <user_d> \(former\), 55 kg × 5, .*, certified`.
- The sheet status matches `✓ Certified by you · .*`, and `-certify` is still
  not visible.

Steps 1–8 and 9 are otherwise unchanged. Header comments in the flow and the
script's `output` key list are updated.

### C. Hermeticity

- **No new fixture user.** Device `user_c` and counterparty `user_d` keep
  their roles. `user_e` stays the linking flow's user. So
  `scripts/tests/maestro-fixture-users.test.sh` needs no change, and it must
  stay green.
- **`groups-fixture-reset.sh`.** Deleting the groups already cascades
  `group_certifications` (`group_id … on delete cascade`, §2.12), and with
  them boards, events, queue, and facts. The build **verifies** this with a
  second consecutive lane run in the same slot and no manual reset. If
  anything leaks, it adds an explicit delete there. The header comment names
  certifications either way.
- The new session ids derive from `groupsSessionId` (timestamped per run),
  so re-runs never collide. user_d's Sync v2 rows are already wiped
  child-first.

### D. Closeout: graduate, then delete

A decision survives only if a spec holds it. The build checks each item
below against `docs/specs/**`. The **gap audit done for this card** found:

| Plan content | Already in specs | Gap → action |
| --- | --- | --- |
| Design T1–T5, T7 (tables, links entity, evaluator runtime, pg_net/pg_cron, persistent stream, materialized boards) | `03` decision register rows; `groups-contract` §2.6–§2.12; `sync-v2-server-contract` A.2.10; `05` | none |
| T6, T8 (lead changes history-only; provisional records) | `groups-contract` §2.11 | none |
| T9 (new `groups-leaderboards` lane) | `02` matrix + trigger row, `06` lane tables, contract §8 | none |
| Certification authz | `10` rule 19, contract §4.6 | none |
| Screen/route changes (Link screen, group page segments, leaderboard routes, record sheet) | `ui/screen-map`, `ui/navigation-contract`, `ui/components-catalog`, `ui/ux-rules` | none |
| **Product rules P1–P19, decisions D1–D17, experiences E0–E3** | dozens of references by ID in `groups-contract`, `03`, `05`, `06`, `ui/*` | **gap**: the IDs would dangle once the product doc is deleted |
| Out of scope (P19) and not-yet-built items | contract §9 lists only M22 carry-forwards | **gap** |
| `groups-contract.md` title/status (`Groups Contract (M22)`); `docs/specs/README.md` index line says "As-built (M22)" | — | **stale** |
| Brainstorm status `phases 2–5 pending` | — | **stale** (phases 3–5 shipped; phase 2 live follow did not) |

Actions:

1. **New `groups-contract.md` §10 "Product rules (M25)"**, so every existing
   `P#` / `D#` / `E#` reference resolves:
   - P1–P19 condensed to one line each;
   - the D1–D17 decision table, one line each (D7 marked superseded by D9);
   - E0–E3 one line each, pointing at the §6.3 as-built section that
     implements them.
   - Only the IDs and rules move. The narrative sketches stay in git
     history, cited by commit.
   - The top-of-doc "not the source for" table then points product
     requirements at §10 for M25 and at git history for M22.
2. **Contract §9** becomes "Not built (carried forward)":
   - live follow (unchanged);
   - PR highlights (unchanged);
   - P19's out-of-scope list: group gyms and gym filters, time-windowed
     boards, bodyweight/reps-only metrics, member proposals, disputes, push
     notifications;
   - drop the stale "Phase 3 links" bullet (shipped: §2.7, A.2.10) and
     reword the "Phase 5" bullet.
3. **Contract header:** retitle `Groups Contract` and add an M25-T11 status
   bullet (the e2e extension, milestone closed). Update the §8 prose:
   M25-T10's "certifying on device is M25-T11" becomes an **As-built
   (M25-T11, flow extension)** bullet with the new steps, outputs, and the
   observed latency lines.
4. **`docs/specs/README.md`:** update the index line for the contract.
5. **Brainstorm** `docs/brainstorms/2026-09-10-group-activity-stream.md`:
   - status line: `phases 3–5 shipped in M25 (contract §10); phase 2 live
     follow pending`;
   - no other brainstorm edit.
6. **`02` / `06`:** `ios-groups-e2e` keeps its name, gate, and triggers.
   Refresh a timing cell only if the table holds a stale measured value, and
   only from `./boga timings`.
7. **Grep gate:**
   - no file outside `docs/plans/**` and git history references the deleted
     paths (`group-exercises-and-leaderboards.md`,
     `group-exercises-tech-design.md`, `M25-group-exercises-and-leaderboards`,
     `M25-T04-T11-later_cards`);
   - references inside the brainstorm are rewritten to the contract.
8. **Delete:**
   - `docs/plans/milestones/M25-group-exercises-and-leaderboards.md`;
   - `docs/plans/group-exercises-and-leaderboards.md`;
   - `docs/plans/group-exercises-tech-design.md`;
   - `docs/plans/tasks/M25-T04-T11-later_cards.md` (its only section is T11,
     so the first commit deletes it);
   - this card.

### Out of scope

- **On-device withdraw / cancel taps.** Both are already covered by the
  `groups-certification.sh` lifecycle body and jest
  (`groups-record-set-sheet.test.tsx`,
  `groups-certification-api.test.ts`). They would add an Alert confirm, a
  second latency wait, and ~30 s to a 3.8 m lane (median, `./boga timings`,
  10 green runs) for no new integration seam. The flow asserts `Remove my
  certification` is offered, and nothing more.
- **A voided record on device** (edit after certify). The backend lane
  already covers voids.
- Any app code, migration, or RPC change. If the e2e exposes a product bug,
  stop and report it; it gets its own fix card or PR.

## Acceptance criteria

1. `push-record` produces a non-provisional `record` item for the new set
   with the asserted payload, or the step fails with the last response. It
   never passes on a timeout.
2. On device, the record card shows `— group record`, the converted value,
   and `○ Not certified yet`. Its session card reads `1 record`.
3. Tapping the card's `Certify` shows the certified notice and then `✓
   Certified by you`, and hides `Certify`.
4. After `await-certified`, the podium, the Certified · e1RM and Weight
   boards, and the Certified history show user_d's 55 kg set certified by
   you. The All row reads `certified`, and its sheet offers `Remove my
   certification`, not `Certify`.
5. Step 8b shows the former member's certified 55 kg × 5 row, and the sheet
   offers no `Certify`.
6. `ios-groups-e2e` is green **twice in a row** in the same slot with no
   manual reset (hermeticity). JUnit, screenshots, and both new latency lines
   are recorded in the PR.
7. `maestro-fixture-users.test.sh` and `meta-tests` are green, and no new
   fixture user is added.
8. Contract §10 exists, and every `P#`/`D#`/`E#` in `docs/specs/**` resolves
   to it (grep listed in the PR). §8 has the T11 as-built, and §9 and the
   header are current.
9. The four plan files and this card are deleted. The grep gate (D.7) is
   clean, and `docs-check` is green.
10. `gh pr list --state merged` shows T01–T10. After T11 merges, the builder
    reports M25 closed.

## Docs touched

See front-matter. There are no `ui/*` edits unless the grep audit finds a
stale route or label. Any such edit is listed under Deviations.

## Testing

| Lane | Why |
| --- | --- |
| `./boga test for --diff origin/main` | Prints the authoritative set; run everything it lists |
| `./boga test fast` | Docs/meta tests (docs-check, fixture-users) + mobile unit |
| `./boga test ios-groups-e2e` ×2 | The changed flow and script (Maestro under `.maestro/**`); second run proves hermeticity |
| `./boga test backend` | Only if `for` requires it (e.g. `supabase/scripts/groups-fixture-reset.sh` touched) |
| `./boga test handles` | Only if jest/app code changes (none planned) |

- Frontend lanes run individually by name, foreground, ≤10 min each.
- If `groups-link-exercise` flakes on "Close filters" (fixed by #299), re-run
  once and record it.
- Evidence: `./boga timings` for durations; the Maestro JUnit and screenshots
  under `maestro-debug/**`.
