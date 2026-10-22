#!/usr/bin/env bash
# Groups performance, Tier 2 (lane groups-perf-load): concurrent loggers
# through the real sync_push → kick → group-eval → notification-worker path,
# then a real idle window on a 10-second pg_cron schedule. Commits a fixture,
# then deletes it and restores the cron schedules, notification cutover and
# Vault entries it changed. Report-only. What it measures:
# docs/specs/tech/groups-performance-measurement.md.
# Execute only through its Boga lane.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SUPABASE_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"

load_supabase_status_env
[[ -n "${DB_URL:-}" && -n "${API_URL:-}" ]] || { echo "[groups-perf-load] FAIL: local Supabase status env is incomplete" >&2; exit 1; }
export DB_URL API_URL ANON_KEY JWT_SECRET SERVICE_ROLE_KEY

cd "${REPO_ROOT}/apps/mobile"
exec npx tsx scripts/perf/groups/cli.ts load ${GROUPS_PERF_STRICT:+--strict}
