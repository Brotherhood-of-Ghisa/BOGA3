#!/usr/bin/env bash
# Atomic mkdir ownership, shared by lanes and lifecycle commands. Sourcing this
# file installs no traps; only the supervising process owns cleanup.
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/worktree-lib.sh"

boga_runtime_project() {
  local root="$1" config project
  boga_require_slot_lease "$root" || return 1
  config="${BOGA_SUPABASE_WORKDIR:-$root}/supabase/config.toml"
  project="$(awk -F'"' '/^project_id[[:space:]]*=/ { print $2; exit }' "$config")" || return 1
  [[ -n "$project" ]] || { echo "[runtime-guard] missing project_id in $config" >&2; return 1; }
  printf '%s\n' "$project"
}

boga_runtime_lock_dir() {
  printf '%s/worktrees/runtime-locks/%s.lock\n' "$(boga_config_root)" "$1"
}

boga_runtime_owned() {
  local project="$1" lock pid
  [[ "${BOGA_RUNTIME_GUARD_PROJECT:-}" == "$project" && -n "${BOGA_RUNTIME_GUARD_TOKEN:-}" ]] || return 1
  lock="$(boga_runtime_lock_dir "$project")"
  [[ "$(cat "$lock/token" 2>/dev/null)" == "$BOGA_RUNTIME_GUARD_TOKEN" ]] || return 1
  [[ "$(cat "$lock/owner.pid" 2>/dev/null)" == "${BOGA_RUNTIME_GUARD_OWNER:-}" ]] || return 1
  kill -0 "${BOGA_RUNTIME_GUARD_OWNER}" 2>/dev/null || return 1
  # A copied environment in an unrelated command is not inherited ownership.
  pid="$$"
  while [[ "$pid" =~ ^[0-9]+$ ]] && (( pid > 1 )); do
    [[ "$pid" != "$BOGA_RUNTIME_GUARD_OWNER" ]] || return 0
    pid="$(ps -o ppid= -p "$pid" | tr -d ' ')"
  done
  return 1
}

# Called before a direct script installs its own EXIT/temporary-file traps.
boga_runtime_guard_script() {
  local root="$1" project
  shift
  project="$(boga_runtime_project "$root")" || exit 1
  boga_runtime_owned "$project" && return 0
  exec "$root/scripts/runtime-guard.sh" "$project" "$(basename "$1")" "$@"
}

boga_runtime_group_alive() {
  local processes
  processes="$(ps -e -o pgid= -o stat=)" || return 2
  awk -v group="$guard_child" '$1 == group && $2 !~ /^Z/ { live=1 } END { exit !live }' <<<"$processes"
}

boga_runtime_term_child() {
  [[ -n "$guard_child" && "$guard_term_sent" == 0 ]] || return 0
  guard_term_sent=1
  kill -TERM -- "-$guard_child" 2>/dev/null || true
}

boga_runtime_stop_child() {
  [[ -n "$guard_child" ]] || return 0
  boga_runtime_term_child
  local polls=50 state=0
  while (( polls-- > 0 )); do
    state=0; boga_runtime_group_alive || state=$?
    (( state != 2 )) || return 1
    (( state == 0 )) || break
    sleep 0.1
  done
  if (( state == 0 )); then
    kill -KILL -- "-$guard_child" 2>/dev/null || true
    polls=20
    while (( polls-- > 0 )); do
      state=0; boga_runtime_group_alive || state=$?
      (( state != 2 )) || return 1
      (( state == 0 )) || break
      sleep 0.1
    done
  fi
  wait "$guard_child" 2>/dev/null || true
  if (( state == 0 )); then
    echo "[runtime-guard] child group $guard_child still running; ownership retained at $guard_lock" >&2
    return 1
  fi
}

boga_runtime_finish() {
  local status="$1"
  trap - EXIT HUP INT TERM
  if (( status != 0 )); then
    boga_runtime_stop_child || return 1
  fi
  # Never remove a replacement lock or another command's ownership.
  if [[ "$(cat "$guard_lock/token" 2>/dev/null)" == "$BOGA_RUNTIME_GUARD_TOKEN" &&
        "$(cat "$guard_lock/owner.pid" 2>/dev/null)" == "$$" ]]; then
    rm -f "$guard_lock/token" "$guard_lock/owner.pid" "$guard_lock/created_at" "$guard_lock/command"
    rmdir "$guard_lock" || return 1
  fi
  return "$status"
}

boga_runtime_signal() {
  guard_signal="$1"
  boga_runtime_term_child
}

boga_runtime_guard_run() {
  local project="$1" label="$2"
  shift 2
  [[ "$project" =~ ^[A-Za-z0-9_.-]+$ && "$project" != . && "$project" != .. ]] || {
    echo "[runtime-guard] invalid runtime project: $project" >&2; return 1;
  }
  if boga_runtime_owned "$project"; then "$@"; return $?; fi

  local guard_lock guard_child="" guard_signal=0 guard_term_sent=0 status=0 monitor=0
  guard_lock="$(boga_runtime_lock_dir "$project")"
  mkdir -p "$(dirname "$guard_lock")" || return 1
  if ! mkdir "$guard_lock" 2>/dev/null; then
    echo "[runtime-guard] runtime $project busy; refusing before mutation." >&2
    echo "[runtime-guard] Holder PID: $(cat "$guard_lock/owner.pid" 2>/dev/null || echo unknown); command: $(cat "$guard_lock/command" 2>/dev/null || echo unknown); since: $(cat "$guard_lock/created_at" 2>/dev/null || echo unknown)" >&2
    echo "[runtime-guard] Lock: $guard_lock. Retry after the holder exits. If abandoned, verify its work has stopped before removing this lock; never remove an active holder's lock." >&2
    return 1
  fi
  local BOGA_RUNTIME_GUARD_PROJECT="$project" BOGA_RUNTIME_GUARD_OWNER="$$"
  local BOGA_RUNTIME_GUARD_TOKEN="$$-$RANDOM-$(date +%s)"
  export BOGA_RUNTIME_GUARD_PROJECT BOGA_RUNTIME_GUARD_OWNER BOGA_RUNTIME_GUARD_TOKEN
  trap 'boga_runtime_finish 1' EXIT
  trap 'boga_runtime_signal 129' HUP
  trap 'boga_runtime_signal 130' INT
  trap 'boga_runtime_signal 143' TERM
  if ! {
    printf '%s\n' "$$" >"$guard_lock/owner.pid" &&
    printf '%s\n' "$BOGA_RUNTIME_GUARD_TOKEN" >"$guard_lock/token" &&
    date -u +'%Y-%m-%dT%H:%M:%SZ' >"$guard_lock/created_at" &&
    printf '%s\n' "$label (cwd $PWD)" >"$guard_lock/command"
  }; then
    boga_runtime_finish 1
    return 1
  fi

  # Bash job control creates a separate process group on both macOS and Linux.
  # Signal only this command's group, including grandchildren and cleanup.
  [[ "$-" != *m* ]] || monitor=1
  set -m
  "$@" <&0 &
  guard_child=$!
  (( monitor != 0 )) || set +m
  (( guard_signal == 0 )) || boga_runtime_term_child
  wait "$guard_child" || status=$?
  (( guard_signal == 0 )) || status="$guard_signal"
  boga_runtime_finish "$status"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  boga_runtime_guard_run "$@"
fi
