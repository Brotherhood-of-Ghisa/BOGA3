#!/usr/bin/env bash

# Lane-timing recorder — sourced by the quality gate wrappers.
#
# Every lane run is timed and written as ONE NEW JSON FILE under
# docs/testing/timings/records/ (append-only: parallel agents, parallel
# worktrees, and branch merges can never conflict because no file is ever
# edited). The reader is ./scripts/test-timings.sh — cite IT for durations,
# never an estimate.
#
# Contract:
#   - recording must NEVER fail or slow a lane: every recording error is
#     swallowed; the lane's own exit code always propagates untouched.
#   - failed lanes are recorded too (exit_code != 0) but the reader excludes
#     them from medians.
#   - disable with BOGA_LANE_TIMING=0 (e.g. for runs on a loaded machine you
#     don't want polluting the dataset).
#
# Usage (from a gate wrapper that has REPO_ROOT set):
#   source "${REPO_ROOT}/scripts/lane-timing.sh"
#   boga_time_lane <lane-name> <command> [args...]

boga_timing_now_ms() {
  perl -MTime::HiRes=time -e 'printf("%d", time()*1000)' 2>/dev/null \
    || echo "$(($(date +%s) * 1000))"
}

# Prints "hw|cores|os" for this machine, best-effort.
boga_timing_machine_fields() {
  local hw="" cores="" os=""
  case "$(uname -s)" in
    Darwin)
      hw="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || uname -m)"
      cores="$(sysctl -n hw.ncpu 2>/dev/null || echo 0)"
      os="macOS $(sw_vers -productVersion 2>/dev/null || uname -r)"
      ;;
    *)
      hw="$(uname -m)"
      cores="$(nproc 2>/dev/null || echo 0)"
      if [[ -r /etc/os-release ]]; then
        os="$(. /etc/os-release && echo "${PRETTY_NAME:-Linux}")"
      else
        os="$(uname -sr)"
      fi
      ;;
  esac
  printf '%s|%s|%s' "${hw}" "${cores}" "${os}"
}

boga_timing_machine_id() {
  local fields
  fields="$(boga_timing_machine_fields)"
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "${fields}" | shasum -a 1 | cut -c1-8
  elif command -v sha1sum >/dev/null 2>&1; then
    printf '%s' "${fields}" | sha1sum | cut -c1-8
  else
    printf 'nohash00'
  fi
}

# boga_record_lane_timing <lane> <wall_ms> <exit_code>
# Writes the record; swallows every error.
boga_record_lane_timing() {
  (
    set +e
    local lane="$1" wall_ms="$2" exit_code="$3"
    local root="${REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}"
    [[ -n "${root}" && -d "${root}" ]] || exit 0
    local dir="${root}/docs/testing/timings/records"
    mkdir -p "${dir}" 2>/dev/null || exit 0

    local fields hw cores os machine_id slot commit stamp safe_lane
    fields="$(boga_timing_machine_fields)"
    hw="${fields%%|*}"
    cores="$(printf '%s' "${fields}" | cut -d'|' -f2)"
    os="${fields##*|}"
    machine_id="$(boga_timing_machine_id)"
    slot="$(cat "${root}/.worktree-slot" 2>/dev/null | tr -d '[:space:]')"
    slot="${slot:-na}"
    commit="$(git -C "${root}" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    safe_lane="$(printf '%s' "${lane}" | tr -c 'A-Za-z0-9._-' '-')"
    # Strip characters that would break the hand-rolled JSON below.
    hw="${hw//\"/}"; os="${os//\"/}"; hw="${hw//\\/}"; os="${os//\\/}"

    cat > "${dir}/${stamp}.${machine_id}.slot${slot}.${safe_lane}.json" <<JSON
{
  "lane": "${safe_lane}",
  "wall_ms": ${wall_ms},
  "exit_code": ${exit_code},
  "recorded_at": "${stamp}",
  "machine_id": "${machine_id}",
  "hw": "${hw}",
  "cores": ${cores:-0},
  "os": "${os}",
  "slot": "${slot}",
  "commit": "${commit}",
  "source": "gate"
}
JSON
  ) 2>/dev/null || true
}

# boga_time_lane <lane-name> <command> [args...]
# Runs the command, records its wall-clock + exit code, propagates the exit
# code (so set -e in the calling gate still fails the gate on a red lane).
boga_time_lane() {
  local lane="$1"
  shift
  if [[ "${BOGA_LANE_TIMING:-1}" == "0" ]]; then
    "$@"
    return $?
  fi
  local start end rc
  start="$(boga_timing_now_ms)"
  if "$@"; then
    rc=0
  else
    rc=$?
  fi
  end="$(boga_timing_now_ms)"
  boga_record_lane_timing "${lane}" "$((end - start))" "${rc}"
  return "${rc}"
}
