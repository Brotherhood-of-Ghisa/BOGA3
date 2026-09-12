# Technical Deep Dives

This folder holds subsystem-level implementation references that sit below the top-level architecture docs.

Current docs:

- `sync-v2-server-contract.md`: authoritative Sync v2 server contract — Part A (server schema, composite PKs, RLS, deferrable FKs, LWW/undelete, drift checker) and Part B (push/pull RPC wire protocol, batch caps, per-layer cursor drain). Verified against the as-built migrations and RPCs.
- `groups-contract.md`: the group domain contract (as-built in M22):
  - group tables and the share-ledger group record;
  - the rule and trigger that share a session into a group;
  - the `SECURITY DEFINER` RPC wire contract and error tokens;
  - stream-card metrics and the SQL/TS parity vectors;
  - the mobile `src/groups` client, local cache, and routes.

Maintenance rule:

- keep these docs concise and implementation-oriented;
- update the relevant deep-dive doc in the same task when the subsystem behavior changes materially.
