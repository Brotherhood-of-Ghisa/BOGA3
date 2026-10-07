# M34-T01-Backend_push_delivery — Durable notification delivery

- Status: `planned`
- Depends on: none
- Milestone: [M34](../milestones/M34-group-workout-notifications.md)
- Areas: backend; UI impact: no

## Objective

Provide the server foundation for native push: account-bound iOS installation
registration, notification preferences and a durable sender with receipt
handling. Ship a dormant foundation that can be verified locally without
creating workout notifications or sending to production group members.

## Scope

- In: backend operational schema, registration/unregistration/preferences
  RPCs, queue claim/send/receipt/failure lifecycle, protected worker invocation,
  local provider sink and backend/Jest coverage.
- Out: group event production, rank detection, mobile UI/native dependencies,
  private sync changes, hosted deployment and real-user test sends.

## Decided

M34 D1, D2 and D4 apply. Implement [[notifications.platform]],
[[notifications.audience]], [[notifications.defaults]],
[[notifications.workout-delivery]] and [[notifications.freshness]] at the
delivery boundary; preserve existing authorization and competition disclosure.

## Design before coding

Choose the smallest schema/RPC/worker design that supports the acceptance
cases. Record ownership, lease/backoff/receipt states, retention, provider
timeouts, registration validation and the opt-in/disable path in a technical
contract. These are implementation decisions; ask only where they would change
an accepted or open product fact.

Design registration around an installation, not one token field on a user
profile. Define token rotation/reassignment and a server-verifiable active
account binding so offline sign-out cannot be waved away as a successful
remote unregister. Distinguish permission from category preference. Scope
registration by build/project/environment; local test fixtures never register
production tokens. Inspect actual current Expo/Supabase APIs before choosing
payloads or credentials.

## Deliverables and acceptance

1. Notification registrations, preferences and deliveries are explicitly
   **out of Sync v2 scope**. Operational tables cannot be mistaken for mirrored
   entities. No credentials, device tokens or delivery payloads are exposed to
   another account, anon or OAuth agent tokens.
2. Authenticated RPCs derive the account from validated auth context and allow
   only that account's installation/preferences operations. Group-specific
   preferences check current membership, with the existing indistinguishable
   outsider/nonexistent boundary. Input validation rejects forged identities,
   invalid environment bindings and oversized/malformed tokens or payloads.
3. Worker endpoints are service-only with explicit authentication. A bounded
   claim lease supports restart and concurrent-worker recovery. Stable logical
   identity prevents duplicate intents and acknowledged sends. Ambiguous
   provider outcomes are classified; do not invent an exactly-once guarantee.
4. Before sending, recheck permission/opt-in state available to the server,
   active installation/account binding, category/group preferences, current
   membership and the original expiry. Provider TTL uses the remaining lifetime,
   not a new 24-hour window for each retry. No unbounded retry loop.
5. Temporary failures back off; permanent payload/credential failures remain
   diagnosable; `DeviceNotRegistered` deactivates the affected token. Persist
   provider tickets and collect receipts without equating receipt success with
   device display. Sanitized diagnostics omit secrets and private content.
6. A local deterministic provider sink verifies request/response handling,
   expiry, concurrency and recovery. With sending disabled or no configured
   provider, jobs have an explicit safe state and personal sync stays healthy.

## Canonical proof allocation

- Jest: portable expiry, logical identity and provider-result decisions.
- Runtime-native Edge units: request auth, validation and provider adapter
  branches that require the Edge runtime.
- Local database/Edge contracts: RPC role matrix, installation reassignment,
  preference persistence, transactional claims, restart, receipts and denied
  direct-table access. Seed state directly except where intake is the claim.
- Integrate bodies into the appropriate existing concepts from
  `scripts/lanes.tsv`; a new lane requires a reason under spec 06. Do not put
  destructive reset/upgrade proofs in a default gate.

## Specs to update

- `docs/specs/05-data-model.md` — out-of-sync operational ownership/classification.
- `docs/specs/03-technical-architecture.md` — queue/sender and auth boundary.
- `docs/specs/09-project-structure.md` — canonical notification module ownership.
- `docs/specs/10-api-authn-authz-guidelines.md` — installation/RPC/worker guards.
- `supabase/README.md` — local sender/sink operation, if runtime setup changes.
- Add one concise owning notification technical contract under
  `docs/specs/tech/` and route it from `docs/specs/tech/README.md` when needed.
- `docs/product/notifications.md` — remove only Pending lines this PR satisfies.

## Gates

Proposed: `./boga test fast` and `./boga test backend`, plus any new body/routing
required by the actual diff. Before running beyond `fast`, agree the set with
the operator using `./boga test for`. No iOS/native code is in scope; propose
lowering unrelated iOS defaults as `covered-by-jest`/backend-contract proof.
Run `jest-coverage`, `complexity`, `dependencies` once before the PR, as agreed.

Follow the task protocol: branch from current main, review the branch and
product facts, open the PR with evidence, stop its stack, delete this card and
mark T01 completed in M34. Merge and worktree release require the usual human
merge authority and owner cleanup.
