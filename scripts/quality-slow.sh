#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck disable=SC1091
source "${REPO_ROOT}/scripts/worktree-lib.sh"
boga_validate_runtime_worktree "${REPO_ROOT}" || exit 1

# Lane-timing recorder: every lane run lands a measurement record under
# docs/testing/timings/records/ (read it back with ./scripts/test-timings.sh).
# shellcheck disable=SC1091
source "${REPO_ROOT}/scripts/lane-timing.sh"

run_in_mobile() {
  (cd "${REPO_ROOT}/apps/mobile" && "$@")
}

usage() {
  cat <<'EOF'
Usage:
  ./scripts/quality-slow.sh [frontend|backend]

Runs local slow quality gates.
- no args: runs all available slow gates (frontend + backend)
- frontend: runs Maestro-based frontend runtime smoke checks + the iOS sync e2e lane
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

  if [[ ! -d "${REPO_ROOT}/apps/mobile/node_modules" ]]; then
    echo "[quality-slow] frontend: dependencies missing; running worktree setup (idempotent)"
    "${REPO_ROOT}/scripts/worktree-setup.sh"
  fi

  echo "[quality-slow] frontend: test:e2e:ios:smoke"
  boga_time_lane ios-smoke run_in_mobile npm run test:e2e:ios:smoke

  echo "[quality-slow] frontend: test:e2e:ios:data-smoke"
  boga_time_lane ios-data-smoke run_in_mobile npm run test:e2e:ios:data-smoke

  echo "[quality-slow] frontend: test:e2e:ios:auth-profile"
  boga_time_lane ios-auth-profile run_in_mobile npm run test:e2e:ios:auth-profile

  # iOS sync e2e — the UI↔server end-to-end lane: real recorder UI, real sync
  # cycle, real local Supabase. Proves a logged workout uploads (dirty -> 0)
  # and survives a full device wipe + re-sign-in (restored from the remote DB).
  echo "[quality-slow] frontend: test:e2e:ios:sync (UI <-> real backend e2e)"
  boga_time_lane ios-sync-e2e run_in_mobile npm run test:e2e:ios:sync
}

run_backend() {
  if [[ ! -x "${REPO_ROOT}/supabase/scripts/test-auth-authz.sh" ]]; then
    echo "[quality-slow] skipping backend auth/authz: wrapper not found or not executable"
  else
    echo "[quality-slow] backend: test-auth-authz"
    boga_time_lane auth-authz "${REPO_ROOT}/supabase/scripts/test-auth-authz.sh"
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
    boga_time_lane sync-v2-schema "${REPO_ROOT}/supabase/scripts/test-sync-v2-schema-smoke.sh"
  fi

  # Sync v2 push RPC contract — exercises the sync-v2 server contract
  # (docs/specs/tech/sync-v2-server-contract.md) Part A §1 (LWW, clamp,
  # undelete) and Part B §3 (envelope, batch caps, FK closure,
  # auth/RLS). Lands with t3.
  if [[ ! -x "${REPO_ROOT}/supabase/scripts/test-sync-push-contract.sh" ]]; then
    echo "[quality-slow] skipping backend sync-push-contract: wrapper not found or not executable"
  else
    echo "[quality-slow] backend: test-sync-push-contract"
    boga_time_lane sync-push-contract "${REPO_ROOT}/supabase/scripts/test-sync-push-contract.sh"
  fi

  # Sync v2 sync_pull RPC contract (t4). Exercises the per-layer cursor
  # protocol — snapshot pull, paginated drain, layer→type partition,
  # RLS isolation, tombstones, empty-page echo, same-millisecond tiebreak,
  # limit/layer bounds, AUTH_REQUIRED.
  if [[ ! -x "${REPO_ROOT}/supabase/scripts/test-sync-pull-contract.sh" ]]; then
    echo "[quality-slow] skipping backend sync-pull-contract: wrapper not found or not executable"
  else
    echo "[quality-slow] backend: test-sync-pull-contract"
    boga_time_lane sync-pull-contract "${REPO_ROOT}/supabase/scripts/test-sync-pull-contract.sh"
  fi

  # Developer-only dev_wipe_my_data RPC contract — exercises the auth guard,
  # the non-production environment guard, and owner-scoped deletion (the
  # caller's rows are removed; a second user's rows survive).
  if [[ ! -x "${REPO_ROOT}/supabase/scripts/test-dev-wipe-my-data.sh" ]]; then
    echo "[quality-slow] skipping backend dev-wipe-my-data: wrapper not found or not executable"
  else
    echo "[quality-slow] backend: test-dev-wipe-my-data"
    boga_time_lane dev-wipe-my-data "${REPO_ROOT}/supabase/scripts/test-dev-wipe-my-data.sh"
  fi

  # Sync v2 drift checker — per docs/specs/tech/sync-v2-server-contract.md Part A §7.5. The TypeScript script
  # lands in t2; until then this block skips with a notice so the slow gate
  # stays green. t2's PR will not need to re-touch this file: when the script
  # exists, the else branch invokes `npm run check:sync-drift -- --strict`.
  if [[ ! -f "${REPO_ROOT}/apps/mobile/scripts/check-sync-schema-drift.ts" ]]; then
    echo "[quality-slow] skipping backend sync-schema-drift: script not found (lands in t2)"
  else
    echo "[quality-slow] backend: sync-schema-drift (boots local supabase + introspects)"
    boga_time_lane sync-drift run_in_mobile npm run check:sync-drift -- --strict
  fi

  # Sync v2 end-to-end (tFINAL). Runs the integration test suite under
  # supabase/tests/sync-v2-*.sh that asserts each plan outcome end-to-end
  # against the as-built stack. Placed after the per-task wrappers above so
  # a per-feature regression surfaces with its targeted failure before the
  # broader integration assertions trip.
  if [[ ! -x "${REPO_ROOT}/supabase/scripts/test-sync-v2-e2e.sh" ]]; then
    echo "[quality-slow] skipping backend sync-v2-e2e: wrapper not found or not executable"
  else
    echo "[quality-slow] backend: test-sync-v2-e2e (integration-level plan outcome assertions)"
    boga_time_lane sync-v2-e2e "${REPO_ROOT}/supabase/scripts/test-sync-v2-e2e.sh"
  fi

  # Mobile sync-infra jest lane (drift-check + cycle-round-trip +
  # cycle-multidevice-lww + auth-required-envelope) against this worktree's
  # local stack. The wrapper provisions the baseline and the
  # SYNC_TEST_SUPABASE_URL/ANON_KEY env itself, so this lane needs no manual
  # setup.
  if [[ ! -x "${REPO_ROOT}/supabase/scripts/test-sync-infra.sh" ]]; then
    echo "[quality-slow] skipping sync-infra: wrapper not found or not executable"
  else
    echo "[quality-slow] backend: test-sync-infra (mobile sync lane vs local stack)"
    boga_time_lane sync-infra "${REPO_ROOT}/supabase/scripts/test-sync-infra.sh"
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
