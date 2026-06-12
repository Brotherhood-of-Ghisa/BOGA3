#!/usr/bin/env bash

# Tests for scripts/gen-docs.sh: check passes on the committed tree, and gen is
# idempotent (running it produces no working-tree diff). Together these prove
# the committed generated blocks are exactly what the generator produces.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
GD="${REPO_ROOT}/scripts/gen-docs.sh"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

"${GD}" check >/dev/null || fail "gen-docs check must pass on the committed tree"

# gen must be a no-op when the tree is current (idempotency). Guard: only run
# this half when the generated file is clean in git, so a developer's
# uncommitted edits don't get clobbered or misattributed.
SPEC="docs/specs/02-quality-and-test-gates.md"
if git -C "${REPO_ROOT}" diff --quiet -- "${SPEC}"; then
  "${GD}" gen >/dev/null
  git -C "${REPO_ROOT}" diff --quiet -- "${SPEC}" \
    || { git -C "${REPO_ROOT}" checkout -- "${SPEC}"; fail "gen-docs gen is not idempotent: it changed ${SPEC} on a current tree"; }
else
  echo "  (skipping idempotency half: ${SPEC} has uncommitted edits)"
fi

echo "  gen-docs: all assertions passed"
