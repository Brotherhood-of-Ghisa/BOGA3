#!/usr/bin/env bash
# Groups performance, Tier 1 (lane groups-perf): deterministic work counters
# per logged set and per idle cron tick, for a history sweep and a members
# sweep, each scenario inside one rolled-back transaction; then the read-path
# set's per-call page budgets and parity cases. The sweeps are report-only;
# the read-path set fails the lane on any budget, slope or parity failure,
# with or without GROUPS_PERF_STRICT. GROUPS_PERF_MATRIX=full runs the
# production-scale matrix. What it measures: docs/specs/tech/groups-performance-measurement.md.
# Execute only through its Boga lane.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SUPABASE_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SUPABASE_DIR}/scripts/_common.sh"

load_supabase_status_env
[[ -n "${DB_URL:-}" && -n "${API_URL:-}" ]] || { echo "[groups-perf] FAIL: local Supabase status env is incomplete" >&2; exit 1; }
export DB_URL API_URL ANON_KEY JWT_SECRET SERVICE_ROLE_KEY

cd "${REPO_ROOT}/apps/mobile"
exec npx tsx scripts/perf/groups/cli.ts tier1 ${GROUPS_PERF_MATRIX:+--matrix "${GROUPS_PERF_MATRIX}"} ${GROUPS_PERF_STRICT:+--strict}
