# Agents

### agents.write-access · definition · accepted

A connected coaching agent reads training data, muscle setup included. Its
training status counts muscles exactly as Today's Plan does; its favourites are
the exercises with the most sessions holding a working set in the last 28 days,
a coach-only order, never the app's Favourites sort. Two per-agent switches
govern changes: **Allow this coach to make changes** (`plan_access_enabled`,
default off; on for agents that already had plan creation) lets it create plans and programmes, and create, edit (name, load mode,
bodyweight contribution, [[gym.split]], [[timer.rest-default]], muscles), soft
delete and restore exercises; **Allow plan edits** (`plan_edit_enabled`,
default off) lets it mutate or delete pending authored plans and programmes via
atomic versioned RPCs. It never mutates performed workouts, cards, sets, or
muscle setup.

Why: separate switches isolate edit blast radius while preserving user workout history;
the coach and the app must agree on what a muscle got, while a coach plans
around current regular lifts, not the app's recency-weighted list.
Approved 2026-10-22.
Code: `loadPlanPermission`, `agent_update_plan_meta` in `supabase/functions/agent-api/index.ts`;
`supabase/functions/agent-api/training-status.ts`.
