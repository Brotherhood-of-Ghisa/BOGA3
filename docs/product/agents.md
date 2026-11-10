# Agents

### agents.write-access · definition · accepted

A connected coach reads training data, muscle setup included. Independent per-client switches bind
writes to the current OAuth grant and default off (existing plan-creation
grants retain main-switch access):

| Switch | Authority |
| --- | --- |
| Make changes (`plan_access_enabled`) | Read upcoming/unscheduled plans; create plans/programmes; create/edit/delete/restore exercises; set weekly muscle targets |
| Edit plans (`plan_edit_enabled`) | Mutate/delete pending authored plans/programmes |
| Log workouts (`workout_logging_enabled`) | Discover active workouts; start/log/edit/finish controlled ad-hoc workouts |

Logging needs neither plan switch. Each active workout has one writer: human,
or one MCP client bound to its grant. MCP-created sessions start MCP-controlled;
phone-created sessions start human-controlled. Online handoffs retain the same
workout and sets. MCP control locks app editing; the timer remains usable.
Human takeover revokes MCP editing. Only the app edits completed history,
plan-backed workouts or muscle setup. Chat sees synced state; human logging works offline.

Why: each write surface needs explicit authority; handoff must preserve acknowledged work.
Approved 2026-11-10.
Code: `loadPlanPermission` in `supabase/functions/agent-api/index.ts`; the edit switch in
`apps/mobile/app/connected-agents.tsx`; edit RPCs in
`supabase/migrations/20261024140000_agent_plan_programme_mutation_rpcs.sql`.
Pending: The edit switch saves the grant, but `supabase/functions/agent-api/index.ts`
has no plan or programme edit routes and does not call those RPCs.
`services/boga-mcp/src/tools.ts` does not expose the corresponding edits.
Code: the independent app grant and handoff live in
`apps/mobile/src/auth/connected-agents.ts` and
`supabase/migrations/20261110145636_workout_handoff.sql`.
Code: `supabase/functions/agent-api/workout-input.ts`;
`supabase/migrations/20261110141726_agent_workout_logging.sql`.

Code: MCP logging tools in `services/boga-mcp/src/workout-tools.ts` delegate to
`services/boga-mcp/src/api-client.ts`.
Code: exclusive session control and handoff in
`supabase/migrations/20261110192235_workout_logging_control.sql` and
`apps/mobile/src/sync/workout-control.ts`.
