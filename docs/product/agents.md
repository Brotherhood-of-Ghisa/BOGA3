# Agents

### agents.write-access · definition · accepted

A connected coaching agent reads training data. One per-agent switch, **Allow
this coach to make changes** (default off, and on for agents that already had
plan creation), also lets it create plans and programmes, and create, edit
(name, load mode, bodyweight contribution, [[gym.split]], muscles), soft delete
and restore exercises. It never edits or deletes plans, changes muscles,
starts a workout, or changes sessions or sets.

Why: an agent can curate the exercise library; one switch keeps consent simple.
Approved 2026-10-19.
Code: `loadPlanPermission` in `supabase/functions/agent-api/index.ts`.
