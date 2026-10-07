#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/_common.sh"

LOCK_DIR="${SUPABASE_DIR}/.temp/runtime-baseline.lock"
LOCK_TIMEOUT_SECONDS="${SUPABASE_BASELINE_LOCK_TIMEOUT_SECONDS:-120}"
LOCK_POLL_SECONDS="${SUPABASE_BASELINE_LOCK_POLL_SECONDS:-1}"

release_lock() {
  if [[ -d "${LOCK_DIR}" ]]; then
    rm -f "${LOCK_DIR}/owner.pid" "${LOCK_DIR}/created_at"
    rmdir "${LOCK_DIR}" 2>/dev/null || true
  fi
}

acquire_lock() {
  ensure_tmp_dir

  local started_at now holder
  started_at="$(date +%s)"

  while ! mkdir "${LOCK_DIR}" 2>/dev/null; do
    now="$(date +%s)"

    if (( now - started_at >= LOCK_TIMEOUT_SECONDS )); then
      holder="unknown"
      if [[ -f "${LOCK_DIR}/owner.pid" ]]; then
        holder="$(cat "${LOCK_DIR}/owner.pid" 2>/dev/null || echo "unknown")"
      fi
      echo "[supabase] timed out waiting for baseline lock (${LOCK_TIMEOUT_SECONDS}s). Holder: ${holder}" >&2
      exit 1
    fi

    sleep "${LOCK_POLL_SECONDS}"
  done

  printf '%s\n' "$$" >"${LOCK_DIR}/owner.pid"
  printf '%s\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >"${LOCK_DIR}/created_at"
  trap release_lock EXIT
}

load_supabase_status_env_if_available() {
  local output line key value

  output="$(run_supabase status -o env 2>/dev/null)" || return 1

  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    [[ "${line}" == *=* ]] || continue

    key="${line%%=*}"
    value="${line#*=}"
    [[ "${key}" =~ ^[A-Z0-9_]+$ ]] || continue

    if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
      value="${value#\"}"
      value="${value%\"}"
    fi

    export "${key}=${value}"
  done <<<"${output}"

  return 0
}

runtime_rest_api_reachable() {
  [[ -n "${API_URL:-}" ]] || return 1
  [[ -n "${ANON_KEY:-}" ]] || return 1

  curl --silent --show-error --fail \
    -H "apikey: ${ANON_KEY}" \
    -H "Authorization: Bearer ${ANON_KEY}" \
    "${API_URL}/rest/v1/dev_fixture_principals?select=fixture_key&limit=1" \
    >/dev/null 2>&1
}

# <function dir> <probe path under /functions/v1>: neither probe ever answers 404
# once its function is served (agent-api → 401, group-eval GET → 405).
FUNCTION_ROUTE_PROBES=(
  "agent-api agent-api/v1/agent/session"
  "group-eval group-eval"
)

ensure_function_routes_registered() {
  local probe name path status missing=""
  for probe in "${FUNCTION_ROUTE_PROBES[@]}"; do
    name="${probe%% *}"
    path="${probe#* }"
    [[ -d "${SUPABASE_DIR}/functions/${name}" ]] || continue
    status="$(
      curl --silent --output /dev/null --write-out '%{http_code}' \
        --max-time 5 \
        -H "apikey: ${ANON_KEY}" \
        "${API_URL}/functions/v1/${path}" \
        2>/dev/null || true
    )"
    [[ "${status}" == "404" ]] && missing="${missing} ${name}"
  done

  [[ -n "${missing}" ]] || return 0

  # The local Edge Runtime snapshots function directories when its container is
  # created. Recreate only this worktree's stack when a checkout adds a function
  # after the runtime was already running; database volumes remain intact.
  echo "[supabase]${missing} absent from the running Edge Runtime; refreshing function routing"
  run_supabase stop >/dev/null
  "${SCRIPT_DIR}/local-runtime-up.sh"
  load_supabase_status_env
}

apply_pending_local_migrations() {
  echo "[supabase] applying pending local migrations"
  run_supabase db push --local --include-all --yes >/dev/null
}

# ---------- once-per-gate stamp ----------
#
# `./boga test <gate>` exports BOGA_GATE_RUN_ID, one value per gate run. The
# full path below ends by stamping a `baseline_ready` row in
# public.local_runtime_bootstrap_markers with that id, a hash of the inputs it
# applied, and a hash of the state it left. A later lane of the same gate skips
# the repairs only if the stamp is there and both hashes still match:
#   - any db reset re-runs seed.sql, which truncates the markers table, so the
#     stamp dies with the database whichever path reset it;
#   - the state hash covers everything the repairs fix (applied migrations,
#     fixture principals, the fixture auth users, the group-eval kick URL), so
#     a body that changed any of it sends the next lane down the full path.
# No gate id (a lane run by name, a direct script call) → always the full path.
BASELINE_STAMP_MARKER="baseline_ready"

# Inputs: what the full path applies (migrations, seed) and the scripts that
# apply it, fixture constants included.
baseline_inputs_hash() {
  cat "${SUPABASE_DIR}"/migrations/*.sql "${SUPABASE_DIR}/seed.sql" \
    "${SCRIPT_DIR}"/*.sh | shasum -a 1 | cut -c1-16
}

# Every USER_*_EMAIL in auth-fixture-constants.sh, so a new fixture user is
# hashed without a second list to keep in step.
baseline_fixture_emails() {
  (
    # shellcheck disable=SC1091
    source "${SCRIPT_DIR}/auth-fixture-constants.sh"
    local var
    for var in ${!USER_@}; do
      [[ "${var}" == *_EMAIL ]] && printf '%s,' "${!var}"
    done
  )
}

# Prints "<stamp details>|<state hash>"; the details are empty when no stamp.
baseline_stamp_and_state() {
  local container
  container="$(resolve_db_container)" || return 1
  docker exec -i "${container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq \
    -v marker="${BASELINE_STAMP_MARKER}" -v emails="$(baseline_fixture_emails)" <<'SQL'
select coalesce((select details from public.local_runtime_bootstrap_markers where marker = :'marker'), '')
  || '|' || md5(row(
    (select string_agg(m.version, ',' order by m.version)
       from supabase_migrations.schema_migrations m),
    (select string_agg(row(p.fixture_key, p.subject_uuid, p.subject_kind, p.email)::text, ';' order by p.fixture_key)
       from public.dev_fixture_principals p),
    (select string_agg(row(u.id, u.email, u.encrypted_password, u.email_confirmed_at, u.banned_until, u.deleted_at)::text, ';' order by u.email)
       from auth.users u where u.email = any(string_to_array(:'emails', ','))),
    app_public.group_eval_config('group_eval_url')
  )::text);
SQL
}

baseline_stamp_details() {
  printf 'gate=%s inputs=%s state=%s' "${BOGA_GATE_RUN_ID}" "$1" "$2"
}

# True when this gate already ensured the baseline and nothing has changed it.
baseline_stamp_current() {
  [[ -n "${BOGA_GATE_RUN_ID:-}" ]] || return 1

  local out details state
  if ! out="$(baseline_stamp_and_state)"; then
    echo "[supabase] baseline stamp check failed; running the full baseline"
    return 1
  fi
  details="${out%|*}"
  state="${out##*|}"

  if [[ -z "${details}" ]]; then
    echo "[supabase] no baseline stamp (first lane of this gate, or the database was reset); running the full baseline"
    return 1
  fi
  if [[ "${details}" != "gate=${BOGA_GATE_RUN_ID} "* ]]; then
    echo "[supabase] baseline stamp is from another gate run; running the full baseline"
    return 1
  fi
  if [[ "${details}" != "$(baseline_stamp_details "$(baseline_inputs_hash)" "${state}")" ]]; then
    echo "[supabase] baseline changed since this gate stamped it (migrations, seed, fixtures or kick URL); running the full baseline"
    return 1
  fi
  return 0
}

write_baseline_stamp() {
  [[ -n "${BOGA_GATE_RUN_ID:-}" ]] || return 0

  local out container
  out="$(baseline_stamp_and_state)"
  container="$(resolve_db_container)"
  docker exec -i "${container}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -Atq \
    -v marker="${BASELINE_STAMP_MARKER}" \
    -v details="$(baseline_stamp_details "$(baseline_inputs_hash)" "${out##*|}")" >/dev/null <<'SQL'
insert into public.local_runtime_bootstrap_markers (marker, details)
values (:'marker', :'details')
on conflict (marker) do update set details = excluded.details, inserted_at = timezone('utc', now());
SQL
  echo "[supabase] stamped baseline for gate ${BOGA_GATE_RUN_ID}"
}

ensure_runtime_and_baseline() {
  local runtime_was_running=0

  if load_supabase_status_env_if_available && runtime_rest_api_reachable; then
    runtime_was_running=1
    echo "[supabase] local runtime already running; reusing existing instance without reset"
  else
    echo "[supabase] local runtime unavailable; starting and bootstrapping baseline"
    "${SCRIPT_DIR}/local-runtime-up.sh"
    "${SCRIPT_DIR}/reset-local.sh"
    load_supabase_status_env
  fi

  ensure_function_routes_registered

  if (( runtime_was_running == 1 )) && baseline_stamp_current; then
    echo "[supabase] local runtime baseline ready (verified against gate ${BOGA_GATE_RUN_ID}'s stamp; repairs skipped)"
    return 0
  fi

  apply_pending_local_migrations

  # The group evaluator's pg_net kick needs this stack's in-network URL (Vault;
  # a db reset clears it). Idempotent.
  "${SCRIPT_DIR}/group-eval-configure.sh"

  if ! "${SCRIPT_DIR}/smoke-seed.sh"; then
    if (( runtime_was_running == 1 )); then
      echo "[supabase] existing runtime is missing required baseline seed fixtures." >&2
      echo "[supabase] run ./supabase/scripts/reset-local.sh once, or restart the local stack, then retry." >&2
    fi
    exit 1
  fi

  echo "[supabase] ensuring deterministic auth fixtures"
  "${SCRIPT_DIR}/auth-provision-local-fixtures.sh"

  echo "[supabase] verifying baseline fixtures after auth provisioning"
  "${SCRIPT_DIR}/smoke-seed.sh"

  write_baseline_stamp
  echo "[supabase] local runtime baseline ready"
}

acquire_lock
ensure_runtime_and_baseline
