# Technical Deep Dives

This folder holds subsystem-level implementation references that sit below the top-level architecture docs.

Current docs:

- `training-metrics-contract.md`: the one definition of what counts toward a
  statistic — the working set and the counted session — and where records and
  calculations are owned.
- `bodyweight-load-contract.md`: current contract for ordinary and optional
  private/group bodyweight calculations, kg-only migration, dated readings,
  privacy and rollout.
- `sync-v2-server-contract.md`: authoritative Sync v2 server contract — Part A (server schema, composite PKs, RLS, deferrable FKs, LWW/undelete, drift checker) and Part B (push/pull RPC wire protocol, batch caps, per-layer cursor drain). Verified against the as-built migrations and RPCs.
- `groups-contract.md`: group domain rules — share ledger and share rule,
  stream, evaluator, boards, certification, comparisons, RPC conventions and
  error tokens, the mobile `src/groups` client and cache, and the rule IDs.
- `session-planning-contract.md`: authoritative technical contract for session
  planning and programmes: data model, schema, 16-entity Sync v2 expansion,
  materialization algorithms, block lifecycle, set reordering invariants, agent
  write permissions/API, and MCP tools.
- `group-competition-contract.md`: group competition representation —
  metric/unit meaning, the public boundary and disclosure, witness history and
  the protocol-4 server surface.

Maintenance rule:

- keep these docs concise and implementation-oriented;
- update the relevant deep-dive doc in the same task when the subsystem behavior changes materially.
