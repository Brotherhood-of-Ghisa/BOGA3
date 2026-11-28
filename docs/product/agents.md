# Agents

### agents.write-access · definition · accepted

A coach reads training data. Per-client write switches bind to the
current grant and default off (existing plan grants retain main access):

| Switch | Authority |
| --- | --- |
| Make changes | Read/create plans/programmes; manage exercises; set targets; notes ([[notes.agent-access]]); log/update injuries |
| Edit plans | Mutate/delete pending plans/programmes |
| Log workouts | Read/start/create/log/edit/finish controlled ad-hoc workouts |

Logging needs neither plan switch. One writer controls each workout: human or
grant-bound MCP client. MCP creation retains control; app creation is human.
Handoff preserves IDs; takeover revokes MCP editing. MCP control locks app edits,
leaving the timer usable. Dated creation takes start/end, stays completed and
permits incremental history without occupying live training. Figures update per
batch; Finish releases control without changing dates/duration. Released history,
planned workouts and muscle setup remain app-only. Chat sees synced data;
human logging works offline. Predictions are exempt.

Why: each write surface needs explicit authority; handoff must preserve acknowledged work.
Approved 2026-11-10.
Code: `loadPlanPermission` in `supabase/functions/agent-api/index.ts`; the edit switch in
`apps/mobile/app/connected-agents.tsx`; edit RPCs in
`supabase/migrations/20261024140000_agent_plan_programme_mutation_rpcs.sql`.
Pending: `services/boga-mcp/src/tools.ts` does not expose the corresponding edits.
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

### agents.group-predictions · definition · accepted

A connected coach acts in its user's groups that have predictions on, with no
per-agent switch: it reads the prediction board and posts, takes, counters or
withdraws offers, with open plus matched stake at most 100 points per group and
week. It also reads, for those groups, the members' group-visible form (weekly
e1RM best and baseline, working sets, records, board leaders), within
[[groups.kg-disclosure]]. Any member's coach may schedule an empty next-week CoW, except that it
may not pick a CoW in two consecutive weeks while another bettor has posted in
the group within four weeks. Owners and admins keep cancel and replace.
Members never place predictions; they watch them.

Why: the group setting and membership gate agents here; a per-agent switch would
hide the market from the people it is for, and CoW scheduling crosses agents,
groups and CoW.
Code: `supabase/functions/agent-api/index.ts`; `supabase/migrations/20261029204606_group_cow_lifecycle.sql`;
`supabase/migrations/20261128100000_group_prediction_agent_reads.sql`.
Pending: the agent routes and tools land with the implementing change.

### agents.prediction-ranking · calculation · accepted

Members see the AIs of a group ranked by the latest settled week's profit, then
all-time profit, then matched bets. AIs with equal standings share a place and
the next place is skipped. Each AI's detail shows its head-to-head record
against each AI it has matched and its last five weeks with results. Profits are signed
play points ([[comparison.change-display]]).

Why: the weekly reset is the game's unit; all-time profit and bets break ties.
Code: `apps/mobile/src/groups/prediction-view-model.ts`;
`supabase/migrations/20261128100000_group_prediction_readers.sql`.

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
