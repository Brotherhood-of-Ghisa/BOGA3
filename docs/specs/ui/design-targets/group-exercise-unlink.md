# Group exercise unlink — accepted brief and visual evidence

## Target

The repository-native [task brief](https://github.com/Brotherhood-of-Ghisa/BOGA3/blob/11a5dd768a32c18c88758aa105a4d2c8cbcdbe11/docs/plans/tasks/T-20260923-01-Group_exercise_unlink_UX.md#ux-contract) governs the behavior. Production styling at `53b2a0f1` governs appearance: existing group rows, sheets, buttons, notices and native alerts. No external design artifact or new route.

- Show an independent `Unlink…` action for a member's linked exercises.
- Confirm one mapping directly; choose one stable personal ID when several are linked.
- Explain leaderboard effects, preserved activity/certifications, and offline/frozen conditions.
- Keep names readable on small phones and actions independently accessible.

## Baseline

Captured before implementation on iPhone 17 Pro, 402 × 874 pt (1206 × 2622 px), iOS 26.5, light:

| Group management / Exercises | Existing Link screen |
| --- | --- |
| [Group baseline](group-exercise-unlink/baseline-group.png) | [Link baseline](group-exercise-unlink/baseline-link.png) |

Full baseline artifacts: `apps/mobile/artifacts/maestro/unlink-baseline/20260923-211121-93401/` and `20260923-211425-94760/`.

## Rendered states

Both devices run iOS 26.5, light. Small: iPhone SE (3rd generation), 375 × 667 pt / 750 × 1334 px. Large: iPhone 17 Pro, 402 × 874 pt / 1206 × 2622 px, matching the baseline viewport.

| State | Small iPhone | Large iPhone |
| --- | --- | --- |
| Linked row | [capture](group-exercise-unlink/small-linked-row.png) | [capture](group-exercise-unlink/large-linked-row.png) |
| Multiple-link chooser | [capture](group-exercise-unlink/small-chooser.png) | [capture](group-exercise-unlink/large-chooser.png) |
| Confirmation | [capture](group-exercise-unlink/small-confirmation.png) | [capture](group-exercise-unlink/large-confirmation.png) |
| Success, second mapping retained | [capture](group-exercise-unlink/small-success.png) | [capture](group-exercise-unlink/large-success.png) |
| Offline cached group | [capture](group-exercise-unlink/small-offline.png) | [capture](group-exercise-unlink/large-offline.png) |
| Offline unlink success | [capture](group-exercise-unlink/small-offline-success.png) | [capture](group-exercise-unlink/large-offline-success.png) |
| Same confirmation from the existing Link screen | [capture](group-exercise-unlink/small-link-confirmation.png) | [capture](group-exercise-unlink/large-link-confirmation.png) |

[Existing Link screen after implementation](group-exercise-unlink/large-link-screen.png), for comparison with its baseline.

## Review

Selected rendered examples are retained here to make the accepted interaction and small-phone wrapping reviewable; the full runtime captures remain under the ignored Maestro artifacts tree.

Intentional changes from the baseline are the separate destructive action beneath linked status, a contextual personal-exercise chooser, the longer native confirmation, and a contextual success notice. The existing page header, card surface, admin chevron, typography and button palette are reused.

Current main places Exercises on the group management page rather than an Exercises segment. The implementation follows that existing layout. Ranking, sharing, certification and schema semantics are unchanged.

Accessibility checks cover 44 pt minimum unlink/chooser/retry controls; wrapped labels; independently exposed admin row and personal-link actions; contextual chooser accessibility labels; modal accessibility scope; and a focus-restoration callback to the launching row after dismissal. Maestro exercises the independent native controls and native confirmation. This does not claim a full manual VoiceOver audit.

## Device evidence and method

The permanent groups flow passed in `apps/mobile/artifacts/maestro/unlink-groups-final/20260923-220104-70645/`; its existing Link-screen flow passed in `20260923-220456-72152/`. The preceding full frontend run passed its other seven lanes. Its first groups attempt stopped on an existing native record-sheet accessibility wait even though the failure screenshot showed the sheet; the complete groups lane then passed on rerun.

The ad hoc viewport flow uses the same group setup and unlink section. For the outage, the host stops only the leased slot's local Kong proxy after the group is cached. It asserts the offline banner and local success, restarts the proxy, waits for API health, requests normal Settings sync, and reuses the authenticated preservation assertions. No application fault-injection code or server ranking changes are involved. Selected captures above show both entry points and the retained second link.

Both viewport/outage runs passed, including reconnect preservation assertions: `apps/mobile/artifacts/maestro/unlink-qa-small-final/20260923-221740-77530` (small) and `apps/mobile/artifacts/maestro/unlink-qa-large/20260923-221416-75888` (large).

Compared with the baseline, names wrap within the row on the smaller viewport; the chooser, confirmation and notices fit without clipped controls. The offline marker remains alongside the success message. The admin action remains a separate native target from unlink.

## Flow-to-test coverage

| Flow / failure | Evidence |
| --- | --- |
| One mapping; all three member roles; Cancel; success without navigation | `groups-exercise-screens.test.tsx` |
| Several mappings; duplicate/missing/deleted names; stable selection; dismiss/reopen; untouched mapping | `groups-exercise-screens.test.tsx`, `groups-exercise-view-model.test.ts` |
| Shared wording; archived, inactive and combined frozen conditions | `groups-link-view-model.test.ts`, both exercise screen suites |
| Read loading/failure and retry; write retry; pending duplicate callbacks; stale target; committed write followed by failed read | Both exercise screen suites, `exercise-group-links-repository.test.ts` |
| Offline local unlink and reconnect notice | Both exercise screen suites; device outage captures |
| Cancel → unlink → sync → both boards exclude set → same completed record/certification → relink restores eligibility; second mapping retained | `groups-two-user-stream.yaml` §7d and `groups-counterparty.js` authenticated assertions |
| Existing ranking/certification semantics | `groups-leaderboards` lane: R5 in `groups-boards.sh` and unlink/relink in `groups-certification.sh` |


## Local gate evidence

Each link is the wrapper-written result for that lane. Earlier attempts are retained in the append-only timing dataset; these rows use the latest completed runs.

| Lane | Result | Measured record |
| --- | --- | --- |
| `lint` | PASS | [record](../../../testing/timings/records/20260923T212133Z.e277734d.slot3.lint.json) |
| `typecheck` | PASS | [record](../../../testing/timings/records/20260923T212138Z.e277734d.slot3.typecheck.json) |
| `jest-full` | PASS | [record](../../../testing/timings/records/20260923T212149Z.e277734d.slot3.jest-full.json) |
| `ui-guardrails` | PASS | [record](../../../testing/timings/records/20260923T212149Z.e277734d.slot3.ui-guardrails.json) |
| `docs-check` | PASS | [record](../../../testing/timings/records/20260923T212404Z.e277734d.slot3.docs-check.json) |
| `meta-tests` | PASS | [record](../../../testing/timings/records/20260923T212240Z.e277734d.slot3.meta-tests.json) |
| `agent-auth-web` | PASS | [record](../../../testing/timings/records/20260923T212243Z.e277734d.slot3.agent-auth-web.json) |
| `mcp-unit` | PASS | [record](../../../testing/timings/records/20260923T212248Z.e277734d.slot3.mcp-unit.json) |
| `backend-fast` | PASS | [record](../../../testing/timings/records/20260923T212220Z.e277734d.slot3.backend-fast.json) |
| `auth-authz` | PASS | [record](../../../testing/timings/records/20260923T202529Z.e277734d.slot3.auth-authz.json) |
| `groups-contract` | PASS | [record](../../../testing/timings/records/20260923T202548Z.e277734d.slot3.groups-contract.json) |
| `groups-leaderboards` | PASS | [record](../../../testing/timings/records/20260923T202631Z.e277734d.slot3.groups-leaderboards.json) |
| `agent-api` | PASS | [record](../../../testing/timings/records/20260923T202637Z.e277734d.slot3.agent-api.json) |
| `sync-v2-schema` | PASS | [record](../../../testing/timings/records/20260923T202645Z.e277734d.slot3.sync-v2-schema.json) |
| `sync-push-contract` | PASS | [record](../../../testing/timings/records/20260923T202651Z.e277734d.slot3.sync-push-contract.json) |
| `sync-pull-contract` | PASS | [record](../../../testing/timings/records/20260923T202657Z.e277734d.slot3.sync-pull-contract.json) |
| `dev-wipe-my-data` | PASS | [record](../../../testing/timings/records/20260923T202702Z.e277734d.slot3.dev-wipe-my-data.json) |
| `sync-drift` | PASS | [record](../../../testing/timings/records/20260923T202731Z.e277734d.slot3.sync-drift.json) |
| `sync-v2-e2e` | PASS | [record](../../../testing/timings/records/20260923T202914Z.e277734d.slot3.sync-v2-e2e.json) |
| `sync-infra` | PASS | [record](../../../testing/timings/records/20260923T202928Z.e277734d.slot3.sync-infra.json) |
| `mcp-smoke` | PASS | [record](../../../testing/timings/records/20260923T202937Z.e277734d.slot3.mcp-smoke.json) |
| `ios-smoke` | PASS | [record](../../../testing/timings/records/20260923T203743Z.e277734d.slot3.ios-smoke.json) |
| `ios-data-smoke` | PASS | [record](../../../testing/timings/records/20260923T203926Z.e277734d.slot3.ios-data-smoke.json) |
| `ios-ui-regression` | PASS | [record](../../../testing/timings/records/20260923T204721Z.e277734d.slot3.ios-ui-regression.json) |
| `ios-exercise-page` | PASS | [record](../../../testing/timings/records/20260923T204944Z.e277734d.slot3.ios-exercise-page.json) |
| `ios-session-view` | PASS | [record](../../../testing/timings/records/20260923T205209Z.e277734d.slot3.ios-session-view.json) |
| `ios-auth-profile` | PASS | [record](../../../testing/timings/records/20260923T205417Z.e277734d.slot3.ios-auth-profile.json) |
| `ios-sync-e2e` | PASS | [record](../../../testing/timings/records/20260923T205725Z.e277734d.slot3.ios-sync-e2e.json) |
| `ios-groups-e2e` | PASS | [record](../../../testing/timings/records/20260923T210654Z.e277734d.slot3.ios-groups-e2e.json) |
| `handles` | PASS | [record](../../../testing/timings/records/20260923T202900Z.e277734d.slot3.handles.json) |
| `ios-gates` | N/A | Optional aggregate; its smoke/data lanes run in `frontend`. No trigger requires this extra lane (`scripts/triggers.tsv`). |
| `jest-sync` | N/A | Optional focused suite; full Jest and sync-infra cover the applicable code. No trigger requires this extra lane (`scripts/triggers.tsv`). |
