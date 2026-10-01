# Maestro restructure

Working plan (ephemeral; delete when the queue below is empty). Goal: Maestro
keeps only what needs a device (spec 06, "Maestro scope policy"); everything
else is Jest, screens over real data (spec 06, "Jest test shapes").

## Done

| PR | What |
| --- | --- |
| #409 | Lanes chosen by judgement and agreed with the operator; Maestro scope policy (new flows need approval, flows state what they prove); full sweep only before release builds; `pr-check` removed. |
| #412 | `helpers/local-data.ts` (real screens over the migrated in-memory DB, seeded through the Maestro harness); migrate-once snapshot (26 ms → 0.15 ms per fixture); `better-sqlite3` pinned to the device's SQLite 3.50 line + parity test; Stats proof `stats-screen-local-data.test.tsx` (6 tests; caught a broken stats SQL filter that the 89 existing stats tests missed). |
| #414 | "Jest test shapes" rule (spec 06, `app/__tests__/README.md`); this plan. |
| #415 | Session completion on real data: `completed-session-local-data.test.tsx` (23 tests, every claim of the session-completion flow that Jest can reach) replaces 27 mocked tests; `completed-session-detail-screen.test.tsx` keeps 14 for states real data cannot produce. `bootLocalApp()` in the helper. |
| #416 | Exercise catalogue on real data: `exercise-catalog-screen.test.tsx` converted in place (18 tests, failures forced with `jest.spyOn` on the real modules), covering the catalogue flow's browser-fixture claims; booted-database snapshot in the helper (~160 ms a test); 4 tests retired that real data now covers (`maestro-harness` fixture rows ×2, `stats-repository` window wiring after a Stats delta assertion, `session-list-repository` delete write). |
| #417 | Exercise page on real data: `exercise-page-screen.test.tsx` converted in place (22 tests on the `exercise-page` fixture, persistence read back from the DB), including the missing/deleted-session states; `exercise-page-persistence.test.ts` 7 → 2 (only the repository guards no screen reaches). |
| #422 | Bodyweight on real data; `ios-bodyweight` lane deleted (row 9). `bodyweight-logging-ui.test.tsx` (exercise page + session view on the `bodyweight-rm-volume` fixture) and `bodyweight-screen.test.tsx` converted in place; `bodyweight-calculation-preference.test.tsx` folded into the latter; editor contribution field in `exercise-catalog-screen.test.tsx`; 2 pure tests retired. |
| this PR | Session view on real data: `session-view-screen.test.tsx` converted in place (37 tests on the `session-view` fixture, every write read back from the DB, the real exercise picker instead of its mock); only the GPS read is faked, plus a failed comparison-history read and a failed draft read forced with `jest.spyOn`. |

## Queue

`cloud` = Jest-only, any session. `mac` = needs the simulator: the PR must
include one run of the named lane on the Mac (green, and its new time from
`./boga timings`). Agree lanes with the operator before running (spec 02).

| # | Where | Task | Done when |
| --- | --- | --- | --- |
| 1 | mac | **Trim `stats-screen-ux.yaml`** to its device claim (harness seeds on-device SQLite and Stats renders it, appendix claim 0) plus the overlay taps that need real gestures, if any; add the `Proves / Why device / Jest counterpart` header. Claims 1–13 are covered by `stats-screen.test.tsx` + `stats-screen-local-data.test.tsx` (the latter also asserts the two overlay titles the appendix flags, `Weekly training load` and `Last 12 months`). | `ios-ui-regression` green on the Mac, new time recorded. |
| 5 | mac | **Trim session-completion, exercise-catalogue, exercise-page flows** to their D claims + headers, after 2–4. | `ios-ui-regression` and `ios-exercise-page` green, times recorded. |
| 6 | mac | **Remove the 16 optional `Open`/`Continue`/`Close` taps** (appendix, "Rule-4 violations"). Check each against a real run first: `data-runtime-smoke`'s header says a fresh install can show the onboarding sheet. | The four affected lanes green, times recorded. |
| 7 | mac | **Fold `session-view-abandon` into `session-view`** (its one claim is Jest-covered at `session-view-screen.test.tsx:322`) or drop it. | `ios-session-view` green. |
| 8 | mac | **Merge `groups-link-exercise` into `groups-two-user-stream`** (step 4b already links on device). | `ios-groups-e2e` green. |
| 9 | done | **Bodyweight.** Operator decision (2026-10-01): no claim needs a device, so delete the lane and drop its captures (no standing visual-review consumer). All 6 claims ported to Jest over real data; the weight sheet's keyboard entry stays on device in `ios-sync-e2e`. Timing anomaly: the 2 recorded runs were 19.5m/20.0m, a fresh run on 2026-10-01 took 1.2m (flow 39s). | Done (this PR). |
| 10 | mac | **Sync e2e B4** (second logged workout) looks redundant with B3; confirm its intent with the operator before cutting. | Decision, then `ios-sync-e2e` green. |
| 11 | any | **Headers** for every remaining flow (appendix, "Headers that do not state what the flow proves"); can ride along with 1, 5–8. | Every flow has the three-part header. |

Screenshots: porting a claim drops its capture unless a device run still takes
it. Before cutting captures, check `docs/specs/ui/ai-design-policy.md` for any
still used as accepted-target comparison input (bodyweight's are).

# Appendix: audit (2026-09-30)

Snapshot of the audit that produced the queue. Line numbers refer to `main` at
that date; re-check them before editing a flow. Stats claims 3 and 5 (P) are
now covered by `stats-screen-local-data.test.tsx`.


Scope: read-only audit of every committed flow against `apps/mobile/app/__tests__/**`.
Durations are the **recorded lane medians** from `docs/specs/02-quality-and-test-gates.md` (lane
matrix); nothing else here is a measured duration. Line ranges are flow lines (`cat -n`).
Jest refs are `file:line` of the `it(`/`it.each(` that asserts the claim (all opened and read).

Class key: **D** = DEVICE, **P** = PORTABLE, **C** = COVERED (Jest already asserts it). A claim whose
logic is covered but whose reason to exist is navigation / native / real I/O is counted **D**
(Jest ref given in brackets).

### 1. Summary

| Flow | Lane | Recorded lane median | #claims | D | P | C | Screenshots | Recommendation |
|---|---|---|---|---|---|---|---|---|
| smoke-launch | ios-smoke | ~58s | 5 | 3 | 0 | 2 | 8 | keep |
| data-runtime-smoke | ios-data-smoke | ~1.3m | 8 | 5 | 0 | 3 | 6 | keep (trim 7–8) |
| stats-screen-ux | ios-ui-regression | ~7.9m (4 flows) | 14 | 1 | 2 | 11 | 16 | move-mostly-to-jest |
| session-completion-states-fixture | ios-ui-regression | ~7.9m (4 flows) | 17 | 3 | 3 | 11 | 32 | trim |
| settings-dev-wipe-local | ios-ui-regression | ~7.9m (4 flows) | 6 | 4 | 1 | 1 | 6 | keep (move 2, 5) |
| exercise-catalogue | ios-ui-regression | ~7.9m (4 flows) | 12 | 1 | 1 | 10 | 24 | move-mostly-to-jest |
| exercise-page | ios-exercise-page | ~2.4m | 12 | 2 | 0 | 10 | 19 | trim |
| session-view | ios-session-view | ~2.2m (2 flows) | 10 | 3 | 1 | 6 | 14 | trim |
| session-view-abandon | ios-session-view | ~2.2m (2 flows) | 1 | 0 | 0 | 1 | 2 | merge (into session-view) or drop |
| bodyweight-entry | ios-bodyweight | ~5.7m | 6 | 0 | 3 | 3 | 7 | move-mostly-to-jest |
| auth-profile-happy-path | ios-auth-profile | ~1.7m | 8 | 6 | 0 | 2 | 8 | keep (trim 3–4) |
| sync-first-run-log-and-roundtrip | ios-sync-e2e | ~2.2m | 8 | 8 | 0 | 0 | 9 | keep (trim B2/B4, confirm intent) |
| groups-two-user-stream | ios-groups-e2e | ~5.4m (2 flows) | 17 | 15 | 1 | 1 | 52 | keep (move 2 claims) |
| groups-link-exercise | ios-groups-e2e | ~5.4m (2 flows) | 5 | 2 | 0 | 3 | 6 | merge (into groups-two-user-stream 4b) |
| **Total** | | | **129** | **53** | **12** | **64** | **209** | |

Screenshot-only steps: all 209 `takeScreenshot` steps are design/review evidence, never the verdict
(spec 06 rule 1). Porting a claim to Jest drops its screenshot unless a device run still captures it —
decide per `docs/specs/ui/ai-design-policy.md` whether each capture is still an accepted-target
comparison input (bodyweight's lane text says its captures feed "three-size visual review").

### 2. Per flow

#### smoke-launch.yaml (ios-smoke)
1. L10-19 dev-client launch lands on Today + tab bar — **D** (dev-client boot, root layout).
2. L20-49 four tabs through the persistent shell — **D** (real navigation) [main-tabs.test.tsx:89, :114].
3. L50-66 tray collapses/expands, handle label flips — **C** main-tabs.test.tsx:63.
4. L67-95 Train Start → empty session view, tab bar stays — **D** (root stack) [train-screen.test.tsx:94].
5. L96-114 Today/Train lead with the active session — **C** today-screen.test.tsx:122, train-screen.test.tsx:69.

#### data-runtime-smoke.yaml (ios-data-smoke)
1. L13-27 harness `reset=data` + teleport on real expo-sqlite — **D**.
2. L28-63 Train → Start → picker search → add with empty set — **D** (keyboard, on-device write) [exercise-picker.test.tsx:578].
3. L64-73 new exercise's first set is W-Up — **C** set-effort-defaults.test.ts:7, exercise-page-model.test.ts:199.
4. L74-94 logger keyboard entry, commit → `135.0 × 8` — **D** (keyboard) [exercise-page-screen.test.tsx:358].
5. L95-117 Finish with no prompt → completion → Done → Stats — **D** (stack replace) [session-view-model.test.ts:140, completed-session-detail-screen.test.tsx:651].
6. L118-139 Stats exercise list reads back the session just written — **D** by design (only on-device
   write→read check, per flow comment L118-124). No Jest twin exists: a repo-level in-memory test
   (write via session-drafts, read via stats/catalog-stats) would give earlier signal; natural home
   `stats-repository.test.ts` (today pure/mocked, needs `in-memory-db` wiring).
7. L140-156 Sessions card → Sessions screen — **C** stats-screen.test.tsx:1107, sessions-screen.test.tsx:76.
8. L157-170 completed row ⋮ sheet, backdrop dismiss — **C** sessions-screen.test.tsx:340.

#### stats-screen-ux.yaml (ios-ui-regression)
0. L41-49 harness seeds fixture into on-device SQLite and Stats renders it — **D** (the one device claim).
1. L29-39 empty state — **C** stats-screen.test.tsx:1498.
2. L53-82 control labels, chips, table header, default Sets sort — **C** stats-screen.test.tsx:1222, :1319.
3. L83-88 fixture 7-day card `Sets (W/Sets) 10 (8)` — **P**; card format **C** :525. Home:
   `stats-screen.test.tsx` (new `describe` rendering `ProgressRoute` over in-memory DB seeded with
   `seedExerciseBlockHistoryFixture({ database })`). Blocker: that file mocks `@/src/data` (L26);
   needs a separate suite that mocks `@/src/data/bootstrap` instead (precedent: groups-screens.test.tsx:19).
4. L91-116 header taps drive local sort + indicators — **C** stats-screen.test.tsx:1372.
5. L118-136 30-day re-query `15 (11)` drops the fixture's invalid set — **P** (re-query **C** :1050;
   invalid-set drop at repo level partly **C** stats-repository.test.ts:56). Same home/blocker as 3.
6. L138-166 muscle view family breakdown rows — **C** stats-screen.test.tsx:541.
7. L168-184 back to exercise view, seeded row listed — **C** stats-screen.test.tsx:1622.
8. L186-215 exercise overlay: title, no close button, 4 metric chips, Daily/Weekly — **C** :1530, :1579, :835
   (the `Weekly training load` / `Last 12 months` titles are not asserted in Jest; add to :835).
9. L216-229 today vs selected heatmap cell — **C** heatmap-marks.test.tsx:52, stats-screen.test.tsx:910.
10. L236-250 metric switch, backdrop dismiss — **C** stats-screen.test.tsx:1569, :1735.
11. L252-313 muscle overlay: only Volume/W-sets chips, week-banner placeholder, Daily hides banner — **C** :802, :1005, :910 (asserts at :939).
12. L315-343 multi-muscle family header → family history "Legs" — **C** stats-screen.test.tsx:688.
13. L345-348 overlay dismissed, muscle view intact — **C** stats-screen.test.tsx:1735.

#### session-completion-states-fixture.yaml (ios-ui-regression) — no header
1. L3-31 one-PR completion: PR card, no pager, sets, muscle row — **C** completed-session-detail-screen.test.tsx:493, :364.
2. L33-92 Summary: exercise/muscle toggle, Sets section, no Edit/View-sets — **C** :204.
3. L95-121 catalog-error completion, Done → Stats — **C** :463, :716, :651.
4. L123-133 unmapped completion: `No mapped working sets for this session.` — **P** (no Jest asserts this copy;
   :305 covers the Summary's `No mapped performed sets…`). Home: completed-session-detail-screen.test.tsx. No blocker.
5. L135-144 missing completion target → one safe exit — **C** :751.
6. L146-199 completed `Edit` opens session view (Start/End, Done, no Finish/⋮, no insights) — **D** (deep link + stack) [session-view-screen.test.tsx:659, completed-session-detail-screen.test.tsx:957].
7. L200-235 set edited on exercise page via keyboard, back — **D** (nav + keyboard) [exercise-page-screen.test.tsx:324].
8. L236-261 invalid/valid Start, autosave-paused notice — **C** session-view-screen.test.tsx:673, :722.
9. L262-278 Done → detail reads edits back (`Start 2026-01-05 07:30`, `275.0 × 6`), no completion replay —
   **P** (write→read across screens; repo half **C** exercise-page-persistence.test.ts:96). Home:
   `exercise-page-persistence.test.ts` (already seeds a Maestro fixture into in-memory DB, L17-29).
10. L279-296 Summary remembers muscle grouping after edit — **C** completed-session-detail-screen.test.tsx:247
    (the `Muscle volume` heading itself is asserted nowhere in Jest).
11. L297-355 record band, exercise ⋮ Append sheet, delete/undelete band, Edit hidden — **C** :928, :976, :1032.
12. L357-381 insights loading/error never block Sets or Edit — **C** :283.
13. L382-396 no-history + unmapped muscle copy — **C** :305.
14. L398-406 missing session empty state + back — **C** :1107.
15. L408-455 two PRs side by side, exercise volume — **C** :493 (the `Exercise volume` heading is not asserted).
16. L456-483 share preview, fail-once error, retry opens native share sheet, dismiss — **D** (native sheet) [preview/error/retry **C** :598].
17. L484-508 consolidated muscle breakdown with `No mapped working sets…`, Done → Stats — **P** for the copy
    (Done → `/progress` **C** :651). Home: completed-session-detail-screen.test.tsx.

#### settings-dev-wipe-local.yaml (ios-ui-regression)
1. L17-49 More → Settings reachable (scroll past minimised tab bar) — **D**.
2. L50-60 date-format segmented row — **C** settings-profile-navigation.test.tsx:147.
3. L61-83 dev-tools card present on the real dev build — **D** (real `isDevMode` gate) [settings-dev-wipe.test.tsx:80].
4. L84-94 wipe-local succeeds, feedback copy — **D** (real expo-sqlite reset) [settings-dev-wipe.test.tsx:89, dev-affordances.test.ts:65].
5. L96-116 dev logs viewer renders its filter row; native back — **P** (no Jest renders `dev-logs-filter-row`;
   more-screen.test.tsx:114 only checks the push). Home: new `dev-logs-screen.test.tsx`. No blocker known.
6. L118-126 app re-bootstraps to a usable data screen — **D**.

#### exercise-catalogue.yaml (ios-ui-regression)
1. L21-41 `stopApp` + dev-client relaunch + reset/fixture teleport — **D** (flag: an extra relaunch per run).
2. L43-53 grouped list, Chest expanded — **C** exercise-list-controls.test.tsx:107, :122.
3. L55-75 sort/never-done controls; Manage sheet with Show deleted; backdrop — **C** exercise-catalog-screen.test.tsx:408, :353.
4. L77-93 row ⋮ Actions sheet Edit/Delete; backdrop — **C** exercise-catalog-screen.test.tsx:450.
5. L95-113 empty Save → name + primary-muscle errors — **C** exercise-catalog-screen.test.tsx:246, :262.
6. L114-147 muscle selector panel, primary chosen — **C** exercise-catalog-screen.test.tsx:512, :119.
7. L148-164 secondary muscle chip, per-side load mode — **C** exercise-catalog-screen.test.tsx:119, :304.
8. L166-181 Save → `Exercise created.` + new row — **C** exercise-catalog-screen.test.tsx:119.
9. L183-218 browser fixture: `Chest exercises 25`, search expands, never-done off hides prior-year row,
   no-match copy, old history — **P** for fixture specifics (behaviour **C** exercise-catalog-screen.test.tsx:426, :487;
   exercise-list-controls.test.tsx:149). Home: `exercise-catalog-screen.test.tsx`; blocker: suite mocks
   `@/src/data/exercise-catalog` (L46), needs an in-memory variant seeded by `seedExerciseBrowserFixture`.
10. L220-260 picker shares prefs, search, appends old plan — **C** exercise-picker.test.tsx:517, :670.
11. L262-288 swap sheet shares prefs, swap applies — **C** exercise-picker.test.tsx:712, exercise-page-screen.test.tsx:620.
12. L290-308 history fail-once: loading, error (no "Never done"), Retry — **C** exercise-catalog-screen.test.tsx:438, exercise-list-controls.test.tsx:165.

#### exercise-page.yaml (ios-exercise-page)
1. L21-54 V5-Quiet: title, `1RM 102.1` record, set toggles — **C** exercise-page-screen.test.tsx:276, exercise-page-persistence.test.ts:226.
2. L56-78 Records → Last → collapse — **C** exercise-page-screen.test.tsx:454, :489.
3. L80-115 records `History` pushes Exercise history (30d vs All time), native back — **D** (stack) [exercise-history-screen.test.tsx:157, :317].
4. L117-153 effort tap cycle RIR 0 → W-Up → none → RIR 3…1 — **C** exercise-page-screen.test.tsx:438, exercise-page-model.test.ts:218.
5. L154-167 long-press effort sheet, pick RIR 0 — **C** exercise-page-screen.test.tsx:417.
6. L169-185 log set 3 via keyboard, logger advances — **D** (keyboard) [exercise-page-screen.test.tsx:358].
7. L187-203 ⋮ sheet (`Remove from session`), backdrop — **C** exercise-page-screen.test.tsx:580.
8. L205-230 swap sheet dismissed without swapping — **C** exercise-page-screen.test.tsx:620, exercise-picker.test.tsx:712.
9. L232-244 `+ Add set` copies last, commit — **C** exercise-page-screen.test.tsx:530.
10. L246-265 Complete warns `2 planned sets will be discarded.`; Cancel, then Complete — **C** exercise-page-screen.test.tsx:544.
11. L267-287 re-open: discarded planned sets kept as not performed — **C** exercise-page-persistence.test.ts:168.
12. L289-370 effort inheritance after warm-up → blank → RIR 3 — **C** exercise-page-model.test.ts:218.
- Also: 5 optional dismissal taps (L25-33, L269-271, L374-376) contradict spec 06 rule 4.

#### session-view.yaml (ios-session-view)
1. L21-56 harness + Train `Resume` → session view — **D** (nav) [train-screen.test.tsx:56].
2. L58-73 summary + read-only cards with done counts and record band — **C** session-view-screen.test.tsx:234 (fixture numbers differ; format covered).
3. L75-88 card → exercise page → back — **D** (stack) [session-view-screen.test.tsx:280].
4. L90-105 ⋮ sheet, backdrop — **C** session-view-screen.test.tsx:322.
5. L107-120 Gym stat → pick gym — **C** session-view-screen.test.tsx:378.
6. L122-175 Manage gyms → Gyms screen → add → native back `Session` → sheet reopens with new gym — **D** (stack + focus) [session-view-screen.test.tsx:531, gyms-screen.test.tsx:120].
7. L177-228 `+ Add exercise`: shared controls, preselection, new search clears it, add empty set — **C** exercise-picker.test.tsx:482, :670; session-view-screen.test.tsx:343.
8. L230-245 live comparison, muscle grouping — **C** session-view-screen.test.tsx:247.
9. L247-261 Finish: one combined cleanup prompt → completion — **C** session-view-model.test.ts:140, session-view-screen.test.tsx:286.
10. L263-286 Today recents lists the finished session — **P** (render **C** today-screen.test.tsx:212; the
    write→read is not). Home: `today-screen.test.tsx`; blocker: suite injects a mocked `dataClient`.

#### session-view-abandon.yaml (ios-session-view)
1. L28-49 ⋮ Abandon → `Abandon session?` → Train with Start, no Resume — **C** session-view-screen.test.tsx:322
   (confirmation, soft delete, `dismissTo('/train')`), train-screen.test.tsx:94. Re-seeds the same fixture
   as session-view; merge as a tail of session-view.yaml or drop.

#### bodyweight-entry.yaml (ios-bodyweight)
1. L5-26 calculations off: preview `1RM 0.0 · VOL 0`, `Weight · kg`, no lb/Added/Body weight — **C** bodyweight-logging-ui.test.tsx:14.
2. L28-41 settings toggle off → on, body-weight row stays — **C** bodyweight-screen.test.tsx:91.
3. L42-64 add 82 kg reading, no lb unit, history row — **C** bodyweight-screen.test.tsx:26.
4. L66-83 calculations on → preview recalculates to `1RM 28.5 · VOL 820` — **P** (repo half **C**
   bodyweight-analytics-data.test.ts:57). Home: `bodyweight-analytics-data.test.ts` or a screen test over
   in-memory DB seeded by `seedBodyweightRmVolumeFixture`; blocker: exercise-page-screen.test.tsx mocks the caches (L34, L60).
5. L85-102 session view row `0.0 × 10`, `1RM 28.5`, `Vol 820`, no `BW +` — **P** for values (format **C** bodyweight-logging-ui.test.tsx:33).
6. L103-116 exercise editor shows bodyweight %, hides movement-standard/loading-method — **P** (no Jest
   references `exercise-editor-bodyweight-percentage`). Home: `exercise-catalog-screen.test.tsx`. No blocker.

#### auth-profile-happy-path.yaml (ios-auth-profile)
1. L11-59 clearState cold launch → sign-in gate — **D** [root-stack-routing.test.tsx:139].
2. L60-77 real GoTrue sign-in, harness bootstrap stamp — **D** [sign-in-screen.test.tsx:65].
3. L78-120 More → Settings: Account / AI coaching sections — **C** settings-onboarding.test.tsx:71.
4. L121-133 About version/release/flavor — **C** settings-onboarding.test.tsx:71.
5. L134-161 Connected agents via real grant-list RPC → empty — **D** (network) [intro **C** connected-agents-screen.test.tsx:50;
   the `connected-agents-empty` state is asserted by no Jest test → add to connected-agents-screen.test.tsx].
6. L162-180 profile loads the real row — **D**.
7. L181-199 username update written to Supabase, `Profile updated.` — **D** [settings-profile-navigation.test.tsx:342].
8. L200-213 sign-out → back to the gate — **D** [root-stack-routing.test.tsx:176].

#### sync-first-run-log-and-roundtrip.yaml (ios-sync-e2e)
A. L57-128 clearState, sign-in, real bootstrap lifts the first-sync gate — **D**.
B1. L129-152 save 80 kg through the reading editor — **D** (UI → dirty rows) [bodyweight-screen.test.tsx:26].
B2. L153-178 conditional abandon of a leftover active session — **D**; duplicates session-view-abandon.
B3. L179-266 log workout 1 through Train/session view/exercise page, Done — **D**.
B4. L267-382 save 82 kg and log workout 2 (same UI path as B3) — **D**, duplicative; D2 only needs both readings,
   which the reading editor alone produces. Trim candidate — confirm intent with the owner.
C. L383-478 forced sync drains Pending changes to `0`; status fields render — **D** [fields **C** sync-status-panel.test.tsx:52, :153].
D. L479-552 wipe + re-sign-in restores the workout from remote — **D**.
D2. L553-578 restored sessions show no body-weight UI; both readings restored — **D**.

#### groups-two-user-stream.yaml (ios-groups-e2e)
1. L27-79 clearState boot, sign in user_c — **D**.
2. L80-101 username prompt before create — **C** groups-write-screens.test.tsx:213.
3. L102-124 create group; `Members, 1 member · You're the owner` — **D** (real RPC) [groups-write-screens.test.tsx:213].
4. L125-136 invite code read off screen, used by counterparty — **D** [groups-write-screens.test.tsx:372].
5. L137-176 counterparty joins; `joined` card; 2 members — **D** (two users).
6. L177-355 4b add/rename/link/archive exercises; member reads list over RPC — **D** [labels **C** groups-exercise-screens.test.tsx:252, :345, :416, :456, :522].
7. L356-395 `Training now` card with metrics after counterparty `sync_push` — **D** [format **C** groups-screens.test.tsx:264].
8. L396-427 completed + edited → same card, updated metrics — **D**.
9. L428-471 friend view read-only — **D** (other user's data) [**C** groups-screens.test.tsx:538].
10. L472-568 7b boards, uncertified row, row detail, link-change history — **D** (server boards) [groups-leaderboards-screens.test.tsx:298, :468; groups-metric-screens.test.tsx:172].
11. L569-696 7c certify per metric, Certified podium/board/history — **D**.
12. L697-862 7d unlink cancel/unlink/preserve/relink through sync — **D**.
13. L863-903, L928-1013 shared bodyweight math, rules revision 2, invalidation on correction — **D** [preview **C** groups-comparison-form.test.tsx:14].
14. L904-927 101 % → `Bodyweight contribution must be from 0% to 100%.`, no preview — **P** (no Jest asserts this copy;
    source src/exercise-core/bodyweight-contribution.ts:12). Home: `groups-comparison-form.test.tsx`. No blocker.
15. L1014-1094 remove counterparty → `was removed` card, shared data kept — **D** [remove action **C** groups-write-screens.test.tsx:574].
16. L1095-1112 former member ranked `(former)`, read-only detail — **D** [**C** groups-leaderboards-screens.test.tsx:298 (assert at :328)].
17. L1113-1119 removed member's read is `NOT_FOUND` — **D** (script only; the device step is a screenshot).

#### groups-link-exercise.yaml (ios-groups-e2e)
1. L25-72 clearState boot, sign in user_e, HTTP setup — **D**.
2. L74-111 catalogue ⋮ → Link screen suggests the group copy; Link — **D** (real group list RPC) [**C** groups-exercise-link-screen.test.tsx:157, exercise-catalog-link-menu.test.tsx:86].
3. L113-150 picker search shows `…, linked: Barbell Bench Press` — **C** exercise-picker.test.tsx:261, :279.
4. L151-160 picking adds my own exercise, not the group name — **C** exercise-picker.test.tsx:292.
5. L162-183 exercise page ⋮ → same Link screen shows the link — **C** exercise-page-screen.test.tsx:600, groups-exercise-link-screen.test.tsx:157.
- Linking is already done on device by groups-two-user-stream 4b (pick sheet, L222-238 of that section);
  merging removes a second clearState boot + sign-in.

### 3. Cross-cutting

#### Jest capability (verified)
- **expo-router rendering is available but rare.** `renderRouter` from `expo-router/testing-library` is used
  in exactly 2 files: root-stack-routing.test.tsx:45/:73 and groups-join-deep-link.test.tsx:11/:56. 35 files
  `jest.mock('expo-router')` instead. Multi-screen hops (card → page → back, Manage gyms → Gyms → back) are
  therefore unasserted in Jest today, but portable with `renderRouter` (proven to work here).
- **How screens are rendered today (examples):**
  - stats-screen.test.tsx: mocks `@/src/data` (L26), caches (L34, L44), `expo-router` (L57); renders
    `StatsScreenShell` with props (L336) or `ProgressRoute` (L22).
  - session-view-screen.test.tsx: mocks `expo-router` (L18), `@/src/data` (L43), insights repo (L56), the
    picker component (L77); renders `SessionViewScreen` (L101); Alerts answered via a helper.
  - sessions-screen.test.tsx: injects a fake `dataClient` prop (L78).
  - groups-screens.test.tsx is the exception: real route + real in-memory DB by mocking only
    `@/src/data/bootstrap` (L14-20). This is the pattern needed for every fixture-value **P** above.
- **Maestro fixtures ARE usable in Jest.** exercise-page-persistence.test.ts:17-29 seeds
  `seedExercisePageFixture` into the in-memory DB; `seedExerciseBlockHistoryFixture` takes `{ database }`
  (src/maestro/exercise-block-history-fixture.ts:460); maestro-harness.test.ts:319 builds its rows.
  So "fixture not available in Jest" is not a blocker; the blocker is that the screen suites mock the data layer.
- Native: share (`mockShareAsync`, `mockCaptureRef` in completed-session-detail-screen.test.tsx:598),
  Alerts, and sheet backdrops (`includeHiddenElements`) are mocked/pressable. The real share sheet,
  keyboard, long-press physics, scroll-to-reach and expo-sqlite itself remain device-only.

#### Duplicated coverage between flows
- Log-a-set path (Train → Start → picker → exercise page logger → Finish → Done → Stats):
  data-runtime-smoke L28-117, sync B3 L179-266, sync B4 L301-382 (same path again), groups-link L113-160 (partial).
- Picker controls `Favourite` / `Name A–Z` / `Show never-done`: session-view L190-192, exercise-catalogue L56-58.
- Exercise-page ⋮ → Swap sheet: exercise-page L205-230, exercise-catalogue L262-288.
- Abandon session: session-view-abandon L28-49, sync B2 L153-178.
- More → Settings scroll: settings-dev-wipe-local L27-49, auth-profile L85-116, sync L388-409.
- Body-weight reading editor: bodyweight-entry L42-64, sync L133-152 and L271-290.
- Group exercise linking: groups-two-user-stream 4b, groups-link-exercise 1-5.
- clearState + dev-menu dismissal boot: auth-profile, sync (x2), groups-two-user-stream, groups-link-exercise.

#### Rule-4 violations (cheap trim, no porting needed)
Optional dismissal taps (`Open` / `Continue` / `Close`) that spec 06 rule 4 forbids (it documents ~7s per
absent tap; not re-measured here): exercise-page L25-33, L269-271, L374-376 (5); session-view L25-33 (3);
session-view-abandon L14-22 (3); bodyweight-entry L6-8 (3); data-runtime-smoke L17-22 (2). 16 in total.

#### Headers that do not state what the flow proves
- session-completion-states-fixture: **no header** (L3 is the first `openLink`).
- smoke-launch, data-runtime-smoke: header is launch-race plumbing only; the proofs live in spec 06.
- Header lists fewer claims than the flow checks: exercise-catalogue (omits L183-308: browser fixture,
  picker, swap, history failure), exercise-page (omits History L80-115 and effort inheritance L289-370),
  session-view (omits live comparison L230-245 and Today recents L263-286), settings-dev-wipe-local
  (omits date format L50-60 and logs L96-116), groups-two-user-stream (omits 7d unlink and bodyweight math).
- bodyweight-entry: a two-line summary, no numbered claims.

#### Timing anomaly
ios-bodyweight's recorded median (~5.7m) is out of line with a 116-line, 34-wait flow (session-view's two
flows total 348 lines at ~2.2m). Spec 02 L25-31 says the lane is due for a rewrite. Check `./boga timings`
before sizing any saving on it.

### 4. Top 5 porting opportunities (HEURISTIC — not measured)
Method: flow share of the lane = its assert/wait steps ÷ the lane's total (ui-regression: stats 66, completion 87,
catalogue 42, settings 11 = 206). Multiply by the lane median, less the ~55-60s shared provision overhead that
maestro-run-lane.sh's comment gives for ui-regression. Then multiply by the fraction of claims that are P+C.
Single-flow lanes that stay alive keep that overhead.

| # | Flow | Basis | Heuristic sim time saved per run |
|---|---|---|---|
| 1 | bodyweight-entry | 6/6 claims P/C; the whole lane could go if its captures move to a manual three-size review | up to ~5.7m (whole lane); verify the anomaly first |
| 2 | session-completion-states-fixture | 42% × (7.9m−~1m) × 14/17 | ~2.4m |
| 3 | stats-screen-ux | 32% × (7.9m−~1m) × 13/14 | ~2.1m |
| 4 | exercise-catalogue | 20% × (7.9m−~1m) × 11/12, plus the `stopApp` relaunch at L21-30 | ~1.3m |
| 5 | exercise-page | (2.4m−~1m) × 10/12, plus 5 rule-4 taps | ~1.2m |

Runners-up: session-view (~0.8m: (2.2m−~1m) × 7/10) with session-view-abandon folded in; groups-link-exercise
merged into groups-two-user-stream (saves one clearState boot + sign-in); sync B4 trim (about 1/5 of that flow's steps).
Prerequisite for 1–4: one shared Jest helper that renders a real route over `createInMemoryDatabase()` by mocking
only `@/src/data/bootstrap` (as groups-screens.test.tsx:14-20 does) and seeds the matching `src/maestro/*` fixture.
**Done in #412** (`helpers/local-data.ts`).
