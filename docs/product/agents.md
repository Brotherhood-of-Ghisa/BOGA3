# Agents

### agents.write-access · definition · accepted

A connected coaching agent reads training data, muscle setup included. Two
per-agent switches govern changes: **Allow this coach to make changes**
(`plan_access_enabled`, default off; on for agents that already had plan
creation) lets it create plans and programmes, and create, edit (name, load mode,
bodyweight contribution, [[gym.split]], [[timer.rest-default]], muscles), soft
delete and restore exercises; **Allow plan edits** (`plan_edit_enabled`,
default off) lets it mutate or delete pending authored plans and programmes via
atomic versioned RPCs. It never mutates performed workouts, cards, sets, or
muscle setup.

Why: separate switches isolate edit blast radius while preserving user workout history.
Approved 2026-10-22.
Code: `loadPlanPermission`, `agent_update_plan_meta` in `supabase/functions/agent-api/index.ts`.
