# Agents

### agents.write-access · definition · accepted

A connected coach reads training data, muscle setup included. Independent
per-agent switches bind changes to the current OAuth grant; all default off
(existing plan-creation grants retain main-switch access):

| Switch | Authority |
| --- | --- |
| Make changes (`plan_access_enabled`) | Read upcoming/unscheduled plans; create plans/programmes; create, edit, delete/restore exercises; change weekly muscle targets |
| Edit plans (`plan_edit_enabled`) | Mutate/delete pending authored plans/programmes |
| Log workouts (`workout_logging_enabled`) | Discover active workouts; start/finish ad-hoc workouts; log, correct/remove their sets |

Logging does not require either plan switch. It cannot edit completed history,
mutate plan-backed workouts or change muscle setup; plan-backed work continues in the app. Offline use remains available;
chat sees only synced server state.

Why: each write surface needs explicit authority; handoff must preserve acknowledged work.
Approved 2026-10-22.
Code: `loadPlanPermission` in `supabase/functions/agent-api/index.ts`; the edit switch in
`apps/mobile/app/connected-agents.tsx`; edit RPCs in
`supabase/migrations/20261024140000_agent_plan_programme_mutation_rpcs.sql`.
Pending: The edit switch saves the grant, but `supabase/functions/agent-api/index.ts`
has no plan or programme edit routes and does not call those RPCs.
`services/boga-mcp/src/tools.ts` does not expose the corresponding edits.
Pending: MCP logging tools are not exposed.
Code: the independent app grant and handoff live in
`apps/mobile/src/auth/connected-agents.ts` and
`supabase/migrations/20261110145636_workout_handoff.sql`.
Code: `supabase/functions/agent-api/workout-input.ts`;
`supabase/migrations/20261110141726_agent_workout_logging.sql`.
