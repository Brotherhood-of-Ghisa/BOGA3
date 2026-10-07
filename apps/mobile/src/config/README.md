# Personal effort configuration

The fixed logging vocabulary lives in `src/exercise-calculations/effort-policy.ts`.
Account-local preferences publish durable Display and calculation choices through
`personal-effort.ts`. Data adapters read that configuration and pass it explicitly
to the pure kernel; groups and coaching keep their shared default rule.

Display filters the picker and cycle; the Working set and Volume columns are
[[set.eligibility]]. Calculation edits invalidate mounted personal
views; facts compare their persisted policy key before serving a read.

See `docs/specs/tech/training-metrics-contract.md` for eligibility and defaults.
