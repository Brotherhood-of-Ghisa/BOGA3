# T-20261104-02 — Resume a completed session

- Status: `planned`
- Depends on: none
- Milestone: none
- Areas: frontend, session persistence; UI impact: yes
- Delivery: one implementation session, one worktree, one PR; delete this card in the shipping PR.

## Objective

Let someone continue a workout they ended by mistake. Resume returns the same
completed session to the current workout, with its session timer running and
normal logging/Finish controls. Edit continues to change completed history
without making the session current.

## Scope

- In: a **Resume session** action on the person's own completed-session detail;
  the completed → active → completed lifecycle; active-session conflicts;
  persistence, navigation, derived-history refresh and sync regression coverage.
- Out: a new session or copied sets; pause/resume time accounting; a rest-timer
  restart; recovering rows already discarded at Finish; undoing plan-block
  resolutions; changes to scoring, notification eligibility or sync protocol;
  a new reusable UI template.

## Decided and verified

- Resume must preserve session identity, original start, gym, exercises, saved
  sets and their identities, tags and plan provenance. It changes the session
  lifecycle rather than replaying or rebuilding its graph.
- Reuse `reopenCompletedSessionDraft` in
  `apps/mobile/src/data/session-drafts.ts`, exported from
  `apps/mobile/src/data/index.ts`. Its transaction already checks for another
  active session, clears `completedAt` and `durationSec`, changes status to
  `active`, dirties the row and nudges sync. It has no production UI caller.
- The existing store also clears `deletedAt`: the new action must reject a
  deleted target at the write boundary, not silently undelete it. Recheck the
  target and active-session constraint when writing.
- Open Train through the existing active-workout navigation helper in
  `apps/mobile/components/navigation/use-open-main-tab.ts`; do not open the
  completed-edit route as the resumed workout. Preserve Back/tab behavior.
- Keep the existing history/facts invalidation and sync mechanisms. Completion
  must materialize a new end and duration on the same session. Do not change
  metric rules or count a resumed session twice.

## Open — settle at implementation kickoff

1. **Timer:** recommended default is elapsed time from the original start,
   including the gap after the mistaken Finish. Example: start 19:50, end
   20:03, resume 20:10 → about 20 minutes. This matches the existing active
   timer but the user has not explicitly selected it. If they want to exclude
   the gap, revisit scope and storage before coding; never move the original
   start to simulate it.
2. **Placement and eligibility:** recommend Resume above Delete in the existing
   Session options sheet, available in both Summary and Sets, for any live
   completed session without a recency cutoff. No routine confirmation dialog.
   This is a proposed UI choice, not recorded human acceptance. If another
   workout is active, show an actionable conflict and offer to open that
   workout; never finish, abandon or replace it automatically.

## UX contract and design target

The repo-native target is the existing View Session screen plus one action:
use `ViewSessionOptionsSheet` in
`apps/mobile/components/view-session/view-session-sheets.tsx`, with its existing
`Sheet`, `ListRow`, typography, spacing and dismissal behavior. Resume is a
normal action above the danger Delete row, using an existing suitable icon.
Retain Edit in the header. The user's reference screenshot shows this sheet
with Delete only; this brief is self-contained for a future session.

Before changing JSX, consult `docs/specs/ui/components-catalog.md` and record
the actual template/variant or custom parent/delta as required by
`docs/specs/08-ux-delivery-standard.md`. The card does not grant a reusable
template promotion. Capture reference/comparison screenshots under the
gitignored `apps/mobile/artifacts/` tree, and link evidence in the PR.

| Flow | Trigger and steps | Success | Failure/edge |
| --- | --- | --- | --- |
| Resume | Own completed detail → ⋮ → Resume session | Commit lifecycle change, dismiss sheet/detail and open Train showing this workout, saved work and a ticking elapsed timer | While pending, suppress repeated/conflicting actions; navigate only after success; failed write leaves the session completed with a readable retryable error |
| Conflict | Resume while another workout is active | Explain the conflict and allow opening the current workout | Neither workout changes; recheck inside the transaction so stale UI cannot bypass the constraint |
| Unavailable target | Deleted, missing, or concurrently changed target | Deleted detail has no Resume; missing/deleted target cannot be restored by this action | Re-read a stale target; if already active, open it without a second transition; otherwise show the appropriate unavailable state |
| Continue and finish | Add/confirm sets in Train → Finish | Same session completes once with its final saved work, new end time and recalculated duration | Existing Finish cleanup and plan handling apply; a failure preserves the active workout for retry |
| Restore and sync | Resume offline → background/relaunch → reconnect | Local current workout survives; normal sync conveys its active state and later completion | Retain existing conflict semantics across devices; do not promise a new global single-active guarantee |

## Implementation and acceptance

1. Wire the action through
   `apps/mobile/app/completed-session/[sessionId].tsx` and
   `apps/mobile/components/view-session/view-session-screen.tsx` to the sheet.
   Keep mutation/error/pending state with the existing controller/data-client
   boundary; avoid copying the workout graph into UI state.
2. Coordinate with `apps/mobile/src/session-entry/coordinator.ts` as needed so
   Start and Resume cannot race into two active local workouts. Keep the
   repository's transactional checks authoritative and handle repeated taps
   and a target already reopened by another operation safely.
3. Add deterministic Jest coverage over the real store for field changes,
   unchanged child IDs/content, deleted/missing/active-conflict rejection and
   re-completion timing. Existing repository tests mock the store; those alone
   do not prove its transactional behavior. Read each test directory's README
   before editing its tests.
4. Cover action visibility in both detail sections, pending/error/conflict
   behavior, navigation to Train, elapsed-time behavior, and Edit retaining
   completed semantics. Prove facts/PR invalidation on reopen and re-completion,
   following `docs/specs/tech/training-metrics-contract.md`; Progress may include
   the current workout under its existing rules, so do not expect all totals
   to drop when reopening.
5. Verify plan provenance and existing resolved blocks survive, following
   [[planner.block-completion]]. Verify shared-session status and existing
   reopen/completion notification behavior without introducing a new event or
   duplicate alert. Reuse existing group/notification contract coverage;
   expand only where the changed behavior lacks proof.
6. Render and capture the options sheet, resumed workout and relevant failure
   states at small/normal phone widths. Check touch targets, screen-reader
   labeling, pending state and standard dismissal. Keep the session elapsed
   timer separate from the already-dismissed rest timer.

## Product changes and documentation

**Planned observable changes:** a completed workout can become current again;
the proposed timer includes the gap; Resume is unavailable on deleted targets
and blocked by another current workout. Highlight the settled decisions in the
implementation PR's `Product facts:` line, following
`docs/procedures/product-facts-authoring.md`. Add/change facts only where its
cross-cutting criteria apply; pin screen-local behavior in code and Jest.
This planning PR changes no accepted facts or runtime behavior.

When implementing the flow, update `docs/specs/ui/navigation-contract.md` and
`docs/specs/ui/screen-map.md` for Resume → Train and its states. When touching
the lifecycle contract, load `docs/specs/05-data-model.md` and
`docs/specs/tech/sync-v2-server-contract.md`; change them only if their rules
actually change. When verifying plan/group/notification effects, load
`docs/product/planner.md`, `docs/specs/tech/session-planning-contract.md`,
`docs/specs/tech/groups-contract.md`, `docs/product/notifications.md` and
`docs/specs/tech/notification-delivery-contract.md`. No migration or protocol
change is expected; report drift before widening scope.

## Gates

- This card-only PR: `./boga test docs-check`; other lanes are lowered for
  `docs-only`, with reviewer agreement recorded in the PR.
- Implementation: run `./boga test for` on the actual diff and agree the lane
  set with the reviewer before the final pass. Expected: `./boga test fast`,
  `./boga test backend`, `./boga test ios-session-view` and
  `./boga test ios-sync-e2e` on macOS. Replace the broad frontend-ui default
  with the flows that exercise this change, with a written reason.
- Before the implementation PR: `./boga test jest-coverage`,
  `./boga test complexity` and `./boga test dependencies`. Add the relevant
  group lanes if the final diff changes group behavior. On Linux select the
  applicable Android lane under `AGENTS.md` instead of iOS lanes.
- Prefer Jest for state rules. A new Maestro scenario needs a written
  device-only justification first; reuse existing session/sync flows where
  possible. Run `./boga doctor` before declaring any selected gate unavailable;
  never quote a duration without `./boga timings` evidence.
- Run separate code and product reviews, attach gate/native evidence to the
  implementation PR, delete this card when shipping, and release the owned
  worktree after the human merges.
