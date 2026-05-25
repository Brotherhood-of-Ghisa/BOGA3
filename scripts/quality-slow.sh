#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
source "${REPO_ROOT}/scripts/worktree-lib.sh"
boga_validate_runtime_worktree "${REPO_ROOT}" || exit 1

usage() {
  cat <<'EOF'
Usage:
  ./scripts/quality-slow.sh [frontend|backend]

Runs local slow quality gates.
- no args: runs all available slow gates (frontend + backend)
- frontend: runs Maestro-based frontend runtime smoke checks
- backend: runs backend auth/RLS + sync API contract suites (shared Supabase runtime baseline enforced by wrappers)

Note: task cards decide when slow gates are mandatory.
EOF
}

area="${1:-all}"

if [[ "${area}" == "--help" || "${area}" == "-h" ]]; then
  usage
  exit 0
fi

run_frontend() {
  if [[ ! -f "${REPO_ROOT}/apps/mobile/package.json" ]]; then
    echo "[quality-slow] skipping frontend: apps/mobile/package.json not found"
    return 0
  fi

  echo "[quality-slow] frontend: test:e2e:ios:smoke"
  (cd "${REPO_ROOT}/apps/mobile" && npm run test:e2e:ios:smoke)

  echo "[quality-slow] frontend: test:e2e:ios:data-smoke"
  (cd "${REPO_ROOT}/apps/mobile" && npm run test:e2e:ios:data-smoke)

  echo "[quality-slow] frontend: test:e2e:ios:auth-profile"
  (cd "${REPO_ROOT}/apps/mobile" && npm run test:e2e:ios:auth-profile)
}

run_backend() {
  if [[ ! -x "${REPO_ROOT}/supabase/scripts/test-auth-authz.sh" ]]; then
    echo "[quality-slow] skipping backend auth/authz: wrapper not found or not executable"
  else
    echo "[quality-slow] backend: test-auth-authz"
    "${REPO_ROOT}/supabase/scripts/test-auth-authz.sh"
  fi

  # Sync v2 schema smoke (replaces the retired v1 sync-api / sync-events-ingest
  # contract suites — those targeted the M13/M14 projection RPC family that the
  # 20260525120000_sync_v2_clean_room migration drops). The v2 push/pull RPC
  # contract suites land alongside t3 (sync_push) and t4 (sync_pull); this
  # smoke test covers the schema shape t1 ships.
  if [[ ! -x "${REPO_ROOT}/supabase/scripts/test-sync-v2-schema-smoke.sh" ]]; then
    echo "[quality-slow] skipping backend sync-v2-schema-smoke: wrapper not found or not executable"
  else
    echo "[quality-slow] backend: test-sync-v2-schema-smoke"
    "${REPO_ROOT}/supabase/scripts/test-sync-v2-schema-smoke.sh"
  fi

  # Sync v2 drift checker — per designs/t1.md §7.5. The TypeScript script
  # lands in t2; until then this block skips with a notice so the slow gate
  # stays green. t2's PR will not need to re-touch this file: when the script
  # exists, the else branch invokes `npm run check:sync-drift -- --strict`.
  if [[ ! -f "${REPO_ROOT}/apps/mobile/scripts/check-sync-schema-drift.ts" ]]; then
    echo "[quality-slow] skipping backend sync-schema-drift: script not found (lands in t2)"
  else
    echo "[quality-slow] backend: sync-schema-drift (boots local supabase + introspects)"
    (cd "${REPO_ROOT}/apps/mobile" && npm run check:sync-drift -- --strict)
  fi
}

case "${area}" in
  all)
    run_frontend
    run_backend
    ;;
  frontend)
    run_frontend
    ;;
  backend)
    run_backend
    ;;
  *)
    echo "[quality-slow] unknown area: ${area}" >&2
    usage >&2
    exit 2
    ;;
esac

echo "[quality-slow] done (${area})"
