# M41 — Conversational workout logging through MCP

- Status: `in_progress`
- Created: 2026-11-10
- Planning baseline: `cbaa180e210a1466c6d524cde09b041e85b2b4a3` on `origin/main`
- Format: repository milestone and cards explicitly requested by the operator;
  this is an exception to the current engine-server planning default.

## Objective

Let a person log an ad-hoc workout while chatting with an AI: start a workout,
record performed sets, correct an entry, and finish. Opening BoGa later must
show the same workout without lost or duplicate sets.

Example: “Start a workout at my gym” → “Bench press, 80 kg for 8” →
“Same again, 7 reps” → “Actually that last set was 75 kg” → “Finish”.

## Scope

- In: active workout discovery, start, one/many-set logging, active-set
  correction/removal, completion, dedicated permission and app/chat handoff.
- Out: authored-plan execution/consumption, completed-history editing,
  backdated imports, a new voice interface, rest-timer control and live push
  updates. MCP logging requires network access; the app retains offline use.
- This PR contains planning documents only. It changes no runtime behavior,
  product fact, permission, schema or published tool catalogue.

## Design direction

### D1. Extend the existing boundary

Keep the path MCP → agent API → owner-filtered atomic backend operations.
Reuse OAuth/grant validation, strict inputs, write receipts and the existing
session/exercise/set graph. MCP holds no database credentials. Review current
shared set semantics through [[set.performed]] and [[set.eligibility]].

### D2. Explicit permission and bounded authority

**Planned product change: [[agents.write-access]].** Introduce a separate,
default-off, per-agent workout-logging permission bound to the live OAuth grant.
Existing plan/exercise permissions must not silently gain workout access.
The target authority is starting and finishing workouts and changing sets only
while their session is active; completed workout history stays outside it.
Update the owning fact and security docs in the implementation PR, including
any accurately scoped `Pending:` notes while mobile disclosure is unfinished.
Exact permission storage and dependence on the existing main switch are open
for T01; all entry points must enforce the settled policy server-side.

### D3. Server state survives the conversation

Proposed tools: `start_workout`, `get_active_workout`, `log_sets`,
`update_set`, `delete_set`, `finish_workout`. T01 settles the operation contract;
T03 settles final tool names and schemas. Calls identify persisted sessions,
exercise blocks and sets. Reads return bounded current state and stable IDs,
so a new chat can recover without relying on earlier assistant messages.
A timed-out retry reuses its operation key; another intentional identical set
uses a fresh key. Set corrections use IDs and concurrency checks.

### D4. Protect both writers before exposing tools

The existing exercise editor replaces one loaded exercise in the latest local
session graph; graph persistence tombstones omitted rows. Per-row LWW alone
therefore does not prove that a stale editor preserves a chat-created set.
T01 defines the concurrency/compatibility contract; T02 implements and proves
app/server protection before T03 exposes logging tools. Include older supported
clients and late offline writes; a new permission alone is not a sync fence.
Never silently resurrect a finished/deleted workout or discard accepted sets.

### D5. Keep conversational interpretation explicit

The AI resolves exercises/gyms against the person's library and translates
reported performance into structured calls. It must clarify consequential
ambiguity rather than invent load, units, reps or exercise identity. The wire
uses canonical kg and the exercise's existing load-input meaning. Starting
checks server-visible active workouts; that check cannot discover an unsynced
phone-only session. T01/T02 settle conflict and resume behavior explicitly.

## Task breakdown

One card = one session = one worktree = one implementation PR. Merge this
planning PR before starting implementation; re-check each card against main.
The implementation PR deletes its card and marks its row completed; the last
also deletes this milestone. Durable rules graduate to their owning docs.

| Task | Summary | Depends on | Status |
| --- | --- | --- | --- |
| M41-T01 | Permission, atomic logging API and compatibility contract | none | completed |
| M41-T02 | Permission UI and safe app/chat/offline coexistence | T01 | completed |
| [M41-T03](../tasks/M41-T03_MCP_workout_tools.md) | MCP tools and complete conversational-flow proof | T01, T02 | planned |

## Risks and completion criteria

- T01 must choose a safe rollout before enabling the new permission; server
  endpoints remain inaccessible without it and the mobile toggle arrives only
  with T02's safety work. Deploy the MCP catalogue only after T02.
- Completion races, two chat callers and reconnecting phones require atomic
  lifecycle checks. Finalization persists completion time/duration once and
  preserves performed-set semantics and existing downstream projections.
- Evidence must cover retry replay versus intentional repetition, correction,
  unauthorized/cross-owner/revoked calls, fresh-chat recovery, stale autosave,
  offline reconnect, competing active workouts and finish-versus-log races.
- Existing group/notification effects remain subject to their owning contracts;
  implementation must check graph-write/completion ordering against them.
- This plan does not require a new Maestro flow. Use existing lanes first;
  justify any device-only scenario that Jest and current flows cannot prove.
