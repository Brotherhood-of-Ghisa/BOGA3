#!/usr/bin/env bash

# run-meta-tests.sh — infra-free self-tests for the repo meta-tooling
# (gen-docs.sh, test-for.sh, pr-check.sh). Runs as the `meta-tests` lane
# (fast gate, repo half; see scripts/lanes.tsv) and in CI.
#
# The worktree-sweep tests in this directory are NOT run here — they exercise
# real git/registry state and remain manual.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

TESTS=(
  "gen-docs.test.sh"
  "test-for.test.sh"
  "pr-check.test.sh"
)

failed=0
for t in "${TESTS[@]}"; do
  echo "[meta-tests] running ${t}"
  if "${SCRIPT_DIR}/${t}"; then
    echo "[meta-tests] PASS ${t}"
  else
    echo "[meta-tests] FAIL ${t}" >&2
    failed=1
  fi
done

if [[ "${failed}" != "0" ]]; then
  echo "[meta-tests] FAILED" >&2
  exit 1
fi
echo "[meta-tests] all passed (${#TESTS[@]} files)"
