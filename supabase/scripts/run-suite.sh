#!/usr/bin/env bash

# run-suite.sh — uniform runner for the backend test bodies in supabase/tests/.
#
# Replaces the per-lane test-*.sh boilerplate wrappers (each was: ensure the
# shared local runtime baseline, run one body). Lane names and which body each
# lane runs live in scripts/lanes.tsv; run lanes via `./boga test <lane>`.
#
#   ./supabase/scripts/run-suite.sh [--no-baseline] <body.sh> [<body.sh>...]
#
# --no-baseline skips the shared baseline preflight, for bodies that manage the
# runtime themselves (local-runtime-smoke.sh boots + resets the stack on its
# own; running the baseline first would double the work).
#
# Group wrappers with real ordering/logic (test-sync-v2-e2e.sh) and lanes with
# special env plumbing (test-sync-infra.sh) keep their own scripts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TESTS_DIR="${SUPABASE_DIR}/tests"

ensure_baseline=1
if [[ "${1:-}" == "--no-baseline" ]]; then
  ensure_baseline=0
  shift
fi

[[ $# -ge 1 ]] || { echo "usage: $0 [--no-baseline] <body.sh> [<body.sh>...]" >&2; exit 2; }

for body in "$@"; do
  [[ -x "${TESTS_DIR}/${body}" ]] || { echo "[run-suite] FAIL: ${TESTS_DIR}/${body} is missing or not executable" >&2; exit 1; }
done

if [[ "${ensure_baseline}" == "1" ]]; then
  echo "[run-suite] ensuring shared local runtime baseline"
  "${SCRIPT_DIR}/ensure-local-runtime-baseline.sh"
fi

for body in "$@"; do
  echo "[run-suite] running ${body}"
  "${TESTS_DIR}/${body}"
done

echo "[run-suite] passed: $*"
