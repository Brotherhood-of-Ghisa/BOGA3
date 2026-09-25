#!/usr/bin/env bash

# full-sweep.test.sh — the scheduled sweep (scripts/full-sweep.sh) is the
# backstop for the selective PR triggers, so it must run EVERY gate lane in
# scripts/lanes.tsv (fast-*, slow-backend, slow-frontend), backend before
# frontend. Infra-free: checks `--dry-run` output only.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

planned="$(BOGA_SWEEP_DIR="$(mktemp -d)/full-sweep" "${REPO_ROOT}/scripts/full-sweep.sh" --dry-run \
  | sed -n 's|^  ./boga test ||p')"
expected="$(grep -v '^[[:space:]]*#' "${REPO_ROOT}/scripts/lanes.tsv" | grep -v '^[[:space:]]*$' \
  | awk -F'\t' '$2 ~ /^(fast-|slow-)/ { print $1 }' | sort)"

[[ "$(sort <<<"${planned}")" == "${expected}" ]] \
  || fail "sweep lanes differ from the registry's gate lanes:$(diff <(sort <<<"${planned}") <(echo "${expected}") || true)"

last_backend="$(grep -n -x -F -f <(awk -F'\t' '$2 == "slow-backend" { print $1 }' "${REPO_ROOT}/scripts/lanes.tsv") <<<"${planned}" | tail -1 | cut -d: -f1)"
first_frontend="$(grep -n -x -F -f <(awk -F'\t' '$2 == "slow-frontend" { print $1 }' "${REPO_ROOT}/scripts/lanes.tsv") <<<"${planned}" | head -1 | cut -d: -f1)"
(( last_backend < first_frontend )) || fail "backend lanes must all run before the first frontend lane"

echo "  full-sweep: $(wc -l <<<"${planned}" | tr -d ' ') lanes planned, every gate lane covered, backend before frontend"
