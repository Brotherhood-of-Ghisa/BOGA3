# Technical Deep Dives

This folder holds subsystem-level implementation references that sit below the top-level architecture docs.

Current docs:

- `sync-v2-server-contract.md`: authoritative Sync v2 server contract — Part A (server schema, composite PKs, RLS, deferrable FKs, LWW/undelete, drift checker) and Part B (push/pull RPC wire protocol, batch caps, per-layer cursor drain). Verified against the as-built migrations and RPCs.

Maintenance rule:

- keep these docs concise and implementation-oriented;
- update the relevant deep-dive doc in the same task when the subsystem behavior changes materially.
