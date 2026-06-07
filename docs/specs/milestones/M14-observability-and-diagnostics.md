# Milestone Spec

## Milestone metadata

- Milestone ID: `M14`
- Title: `Observability and Diagnostics`
- Status: `in_progress`
- Owner: `AI + human reviewer`
- Target window: `2026-05`

## Parent references

- Project directives: `docs/specs/README.md`
- Product overview: `docs/specs/00-product.md`
- Architecture: `docs/specs/03-technical-architecture.md`
- Data model: `docs/specs/05-data-model.md`
- Testing strategy: `docs/specs/06-testing-strategy.md`
- Project structure: `docs/specs/09-project-structure.md`

## Milestone objective

Add minimal production diagnostics for auth and sync failures without introducing a separate observability provider or user-facing log UI.

## In scope

- Supabase-backed app diagnostic log storage.
- Small mobile logging helper that reuses the existing Supabase client.
- High-value auth and sync failure instrumentation.
- Manual inspection through Supabase Dashboard / SQL Editor.

## Out of scope

- Sentry, Better Stack, Axiom, Firebase, Crashlytics, or similar providers.
- In-app dashboards or admin screens.
- Broad instrumentation sweeps.
- Logging auth/session/user objects, passwords, tokens, or large sync payloads.

## Deliverables

1. `public.app_logs` migration with insert-only authenticated RLS.
2. Mobile `logEvent()` helper with client metadata enrichment and sensitive context key stripping.
3. Auth and sync failure instrumentation for restore, sign-in, ingest RPC, bootstrap, flush transport, and bootstrap remote fetch failures.
4. Documentation for diagnostics architecture, data-model ownership, and local/manual inspection.

## Acceptance criteria

1. Authenticated clients can insert app diagnostic logs.
2. Clients cannot select, update, or delete app diagnostic logs.
3. Logging attempts are non-blocking and never change auth or sync behavior.
4. Diagnostic context remains intentionally small and scrubbed.

## Task breakdown

1. `M14-T01-minimal-supabase-app-logging` - `completed` - Minimal Supabase-backed app logging.
2. `T-20260510-01-supabase-migration-history-repair` - (`completed`) - Repaired hosted Supabase migration history for the FK relaxation and `public.app_logs`; local verification and hosted metadata repair are complete.

## Risks / dependencies

- Supabase local/runtime validation is required for RLS confidence.
- Logs may contain user-provided messages if future callers add broad context; helper-level sensitive key stripping is a guardrail, not a full data-loss-prevention system.

## Completion note

- Milestone remains `in_progress` after M14-T01 until follow-up diagnostics needs, if any, are confirmed.
