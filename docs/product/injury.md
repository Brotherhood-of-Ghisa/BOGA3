# Injury

### injury.lifecycle · definition · accepted

An injury tracks tissue discomfort through four lifecycle states:
- `acute`: high pain or fresh injury; triggers a prominent warning banner on affected exercises.
- `managing`: active adaptation or modified training; triggers a subtle warning badge.
- `monitoring`: low-grade discomfort or returning load; triggers a subtle warning badge.
- `resolved`: recovered and pain-free; triggers no live workout warnings.

Active warnings (`acute`, `managing`, `monitoring`) alert lifters when an exercise maps to affected muscles. Dismissing a warning suppresses it in memory for the active workout session only, without altering stored injury records. Skipping an exercise due to pain or discomfort logs a structured skip reason.

Why: keeps lifters aware of compromised tissue during workouts while allowing session-scoped dismissal and structured skip tracking.
Code: `apps/mobile/src/injuries/injury-warning-engine.ts`; `apps/mobile/src/injuries/use-session-injury-warnings.ts`; `components/injuries/`.

### injury.privacy · principle · accepted

Injuries and physical discomfort entries are strictly owner-private user data. They are never broadcast to group feeds, shared on group boards, or visible to other group members under any circumstances. External coach agents and MCP tools cannot access, query, or modify injury records without the lifter's explicit runtime consent; logging or updating an injury requires active plan write permissions (`plan_access_enabled`).

Why: physical vulnerability and injury data is sensitive health context that must never leak to social contexts and requires deliberate authorization for automated coaches.
Code: `docs/specs/tech/injury-contract.md`; `supabase/migrations/20261113081138_injuries_sync_v2.sql`; `supabase/functions/agent-api/injuries.ts`.

### injury.reload-threshold · calculation · accepted

Tissue reload tracking compares current-week working sets ($S_{\text{curr}}$) against the 4-week pre-injury baseline weekly average ($\bar{S}_{\text{pre}}$) over $[T_{\text{injury}}-28\text{d}, T_{\text{injury}})$. A caution alert triggers when $S_{\text{curr}} \ge 6$ and either $\bar{S}_{\text{pre}} = 0$ or $S_{\text{curr}} > 1.30 \times \bar{S}_{\text{pre}}$. Rehab sets ($R_{\text{curr}}$) track therapeutic volume in kilograms without counting toward working-set reload stress. Reloading metrics remain strictly owner-private.

Why: protects recovering tissue against volume spikes exceeding 130% of healthy capacity while suppressing noise when working sets are below the 6-set floor.
Code: `apps/mobile/src/injuries/tissue-reload.ts`; `components/injuries/tissue-reload-card.tsx`.
