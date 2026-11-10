# M41-T02 — Safe mobile and chat workout handoff

- Status: `planned`
- Depends on: M41-T01
- Milestone: [M41](../milestones/M41-mcp-workout-logging.md)
- Areas: mobile, auth, sync, backend as required; UI impact: yes

## Objective and scope

Make app editing and server-side chat logging coexist without silent data loss.
Expose the dedicated permission only with the protection agreed in T01.
MCP tools remain for T03; this task does not add historical editing or plan
execution. Follow milestone D2, D4 and D5.

## Baseline to verify

For session writes, inspect `apps/mobile/src/data/session-drafts.ts`,
`apps/mobile/src/session-recorder/session-exercise-draft.ts` and
`apps/mobile/src/session-recorder/session-lifecycle.ts`. For permission UI,
inspect `apps/mobile/app/connected-agents.tsx` and
`apps/mobile/src/auth/connected-agents.ts`.
Load `docs/specs/05-data-model.md`,
`docs/specs/tech/sync-v2-server-contract.md`, and the T01 contract before
choosing the smallest protection. For UI changes, load
`docs/specs/08-ux-delivery-standard.md`, `docs/specs/ui/README.md` and
`docs/specs/ui/ai-design-policy.md`; use the existing permission-row pattern.

## Open — resolve before coding

T01 contract: `docs/specs/tech/agent-workout-contract.md`. Use an independent
`agent_workout_permissions` row, no dependence on the plan switches. Extend
factor-one revision recovery to sessions, empty workouts and absent offline
blocks; preserve dirty lifecycle input before forcing canonical snapshots.
Agent API mutations use opaque whole-graph revision tokens. Permission table
app privileges remain withheld until this task's safety work is green.

- Implement T01's compatibility contract: define what an older supported app
  may push, how stale snapshots are detected/rebased/rejected, and how the
  user recovers from a real conflict without losing acknowledged work.
- Decide focused-screen refresh versus unsaved input handling; finish/delete
  received remotely; and which active session opens after an offline collision.
  Do not silently merge distinct workouts or hide an unresolved second one.
- Settle the permission label/disclosure and unavailable/error states, including
  the existing disclosures that say agents cannot start workouts or change
  logged sets. Agree the design target before significant UI work.
- If a protocol cutoff is necessary, load `docs/procedures/rule-upgrade.md` and
  settle server-first deployment and supported-client behavior before coding.

## Deliverables and acceptance

1. A set accepted through the agent API survives a later stale app autosave,
   same-exercise correction and offline reconnect. Legitimate app edits and
   intentional removals still work; conflicting edits are surfaced/recovered.
2. A chat-finished/deleted session cannot be reopened or overwritten by stale
   in-memory input or late mobile pushes. Exercise ordering/IDs and confirmed
   performance survive sync, navigation and reinstall/restore.
3. Exercise the reverse handoff too: app-authored data reaches agent reads;
   server writes reach the recorder after normal sync. No requirement for
   background delivery or a persistent MCP connection is introduced.
4. The independent default-off permission displays, saves and revokes against
   the current grant. Failure/unavailable states never display false success;
   other write grants retain their authority. Update all affected disclosure.
5. Jest with real repository/sync semantics covers stale graphs, dirty rows,
   finish/edit races and two active sessions; local backend contracts cover any
   fence. Existing iOS sync/device flows verify real handoff and permission UI.
   Add Maestro coverage only with a written device-only justification.
6. Prove rollout safety for older supported clients or enforce/document the
   agreed compatibility cutoff before anyone can enable logging.

## Owning docs to update when implementing

- `docs/product/agents.md` ([[agents.write-access]]) and
  `docs/specs/10-api-authn-authz-guidelines.md`: permission/disclosure parity.
- `docs/specs/05-data-model.md` and the sync contract: protection, conflict and
  lifecycle invariants; protocol migration procedure if needed.
- Update the owning UI/navigation contract only if handoff behavior changes it.

## Gates

Recompute with `./boga test for`; settle lanes with an independent reviewer.
Expected on macOS: `fast`, `backend`, `ios-sync-e2e`, affected `frontend-ui`
flows, plus `jest-coverage`, `complexity`, `dependencies`. Use platform-relevant
Android lanes on Linux; add group lanes only if group behavior changes.
Obtain independent code, security and product reviews.
