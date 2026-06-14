#!/usr/bin/env bash

# Tests for scripts/test-for.sh (trigger matcher). Infra-free: explicit paths
# only, no git diff.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
TF="${REPO_ROOT}/scripts/test-for.sh"

fail() { echo "  ASSERT FAILED: $*" >&2; exit 1; }

# requires <expected-lane> <paths...>: asserts the lane is in the union.
requires() {
  local lane="$1"; shift
  "${TF}" --tsv "$@" | cut -f1 | grep -qx "${lane}" \
    || fail "expected '${lane}' required for: $* — got: [$("${TF}" --tsv "$@" | cut -f1 | tr '\n' ' ')]"
}
not_requires() {
  local lane="$1"; shift
  if "${TF}" --tsv "$@" | cut -f1 | grep -qx "${lane}"; then
    fail "did NOT expect '${lane}' required for: $*"
  fi
}

# sync runtime → fast + backend + ios-sync-e2e, not frontend
requires fast          apps/mobile/src/sync/scheduler.ts
requires backend       apps/mobile/src/sync/scheduler.ts
requires ios-sync-e2e  apps/mobile/src/sync/scheduler.ts
not_requires frontend  apps/mobile/src/sync/scheduler.ts

# auth wiring behaves like sync
requires ios-sync-e2e  apps/mobile/src/auth/service.ts

# UI → fast + frontend, not backend
requires fast          apps/mobile/components/Button.tsx
requires frontend      apps/mobile/components/Button.tsx
not_requires backend   apps/mobile/components/Button.tsx

# server schema → backend only (no mobile gates)
requires backend       supabase/migrations/20990101_x.sql
not_requires fast      supabase/migrations/20990101_x.sql
not_requires frontend  supabase/migrations/20990101_x.sql

# docs → docs-check only
requires docs-check    docs/specs/05-data-model.md
not_requires fast      docs/specs/05-data-model.md

# meta-tooling → meta-tests
requires meta-tests    scripts/pr-check.sh
requires meta-tests    scripts/tests/fixtures/pr-bodies/good.md

# Maestro flows / runner → frontend + meta-tests (the fixture-user rule guard)
requires frontend      apps/mobile/.maestro/flows/smoke-launch.yaml
requires meta-tests    apps/mobile/.maestro/flows/smoke-launch.yaml
requires meta-tests    apps/mobile/scripts/maestro-run-lane.sh

# union across files
requires backend       apps/mobile/components/Button.tsx supabase/tests/x.sh
requires frontend      apps/mobile/components/Button.tsx supabase/tests/x.sh

# unmatched path → no requirements, exit 0
out="$("${TF}" --tsv some/random/file.xyz)"
[[ -z "${out}" ]] || fail "expected no requirements for unmatched path, got: ${out}"

echo "  test-for: all assertions passed"
