# Agents

### agents.write-access · definition · accepted

A coach reads training data. Independent per-client write switches bind to the
current OAuth grant and default off (existing plan grants retain main access):

| Switch | Authority |
| --- | --- |
| Make changes (`plan_access_enabled`) | Read/create plans/programmes; manage exercises; set targets; notes ([[notes.agent-access]]) |
| Edit plans (`plan_edit_enabled`) | Mutate/delete pending plans/programmes |
| Log workouts (`workout_logging_enabled`) | Read/start/create/log/edit/finish controlled ad-hoc workouts |

Logging needs neither plan switch. One writer controls each workout: human or
one grant-bound MCP client. MCP creation retains control; app creation is human.
Handoff preserves IDs; takeover revokes MCP editing. MCP control locks app edits,
leaving the timer usable. Dated creation takes start/end, stays completed and
permits incremental history without occupying live training. Figures update per
batch; Finish releases control without changing dates/duration. Released history,
planned workouts and muscle setup remain app-only. Chat sees synced data;
human logging works offline.

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

### agents.health-activities · definition · accepted

A connected coach reads the workouts the person's phone imports from their
health app (Apple Health): every activity type, summary figures only (no
routes or samples), under the base read grant with no extra switch. Imported
activities never count as sets, Volume, records or group figures and are never
shared with groups. A watch strength workout overlapping a logged session is
the same training: it stays listed, flagged, and is left out of the coach's
cardio summary.

Why: the coach should factor cardio into advice without counting a gym session twice.
Code: `supabase/functions/agent-api/activities.ts`;
`supabase/migrations/20261110213906_health_activities.sql`.
Code: the phone import in `apps/mobile/src/health-import/`.
