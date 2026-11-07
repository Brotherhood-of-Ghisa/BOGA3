# Agents

### agents.write-access · definition · accepted

A connected coaching agent reads training data, muscle setup included. Two
per-agent switches govern changes: **Allow this coach to make changes**
(`plan_access_enabled`, default off; on for agents that already had plan
creation) lets it read upcoming and unscheduled plans, create plans and
programmes, and create, edit (name, load mode, bodyweight contribution,
[[gym.split]], [[timer.rest-default]], muscles), soft delete and restore
exercises. It also allows changes to weekly muscle targets.
**Allow this coach to edit plans** (`plan_edit_enabled`, default off) lets it
mutate or delete pending authored plans and programmes via atomic versioned
RPCs. A coach never mutates performed workouts, cards, sets, or muscle setup.

Why: separate switches isolate edit blast radius while preserving user workout history.
Approved 2026-10-22.
Code: `loadPlanPermission` in `supabase/functions/agent-api/index.ts`; the edit switch in
`apps/mobile/app/connected-agents.tsx`; edit RPCs in
`supabase/migrations/20261024140000_agent_plan_programme_mutation_rpcs.sql`.
Pending: The edit switch saves the grant, but `supabase/functions/agent-api/index.ts`
has no plan or programme edit routes and does not call those RPCs.
`services/boga-mcp/src/tools.ts` does not expose the corresponding edits.
The main switch's disclosure in `apps/mobile/app/connected-agents.tsx` omits
weekly muscle target changes.
