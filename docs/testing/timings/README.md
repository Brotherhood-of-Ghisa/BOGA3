# Lane-timing records

Measured wall-clock records for local test-lane runs. **Do not edit or delete
files here by hand** — the dataset is append-only: the quality gate wrappers
write one new JSON file per lane run (via `scripts/lane-timing.sh`), and
`./scripts/test-timings.sh` aggregates them.

- `records/*.json` — one record per gate-run lane (filename:
  `<utc>.<machine-id>.slot<slot>.<lane>.json`).
- `records/*.ndjson` — bulk/seed records, one JSON object per line.

Record fields: `lane`, `wall_ms`, `exit_code`, `recorded_at`, `machine_id`
(sha1 of hw|cores|os, first 8 chars), `hw`, `cores`, `os`, `slot`, `commit`,
`source`.

Commit new records with your PR. Interpretation guide:
`docs/testing/local-test-timings.md`.
