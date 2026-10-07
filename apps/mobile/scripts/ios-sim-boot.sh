#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
# For the pinned iOS runtime (BOGA_IOS_SIM_RUNTIME, honouring IOS_SIM_RUNTIME)
# and the simctl queries below. Sourcing it has no side effects and needs no
# slot lease. Deliberately NOT re-resolving the pin here: one place decides it.
# shellcheck disable=SC1091
source "$REPO_ROOT/scripts/worktree-lib.sh"

IOS_SIM_DEVICE="${IOS_SIM_DEVICE:-iPhone 17 Pro}"
IOS_SIM_UDID="${IOS_SIM_UDID:-}"
IOS_SIM_AUTO_CREATE="${IOS_SIM_AUTO_CREATE:-0}"
# Hard deadline for boot + boot-ready. `simctl bootstatus -b` blocks until boot
# completes, so a device that never finishes booting (e.g. SpringBoard
# crash-looping) would otherwise hang the gate forever. Measured cold boot is
# seconds; a freshly created device's first boot is well under a minute.
IOS_SIM_BOOT_TIMEOUT_SECONDS="${IOS_SIM_BOOT_TIMEOUT_SECONDS:-120}"
# Separate bound for the create/delete/shutdown calls that put the device on the
# pinned runtime. Deleting a simulator discards gigabytes of its data directory,
# so it is slower than a boot and must not eat the boot budget.
IOS_SIM_CREATE_TIMEOUT_SECONDS="${IOS_SIM_CREATE_TIMEOUT_SECONDS:-300}"
MODE="${1:-boot}"

# run_bounded <seconds> <cmd...>: run cmd in its own process group; on timeout
# TERM then KILL the whole group (no orphaned simctl) and return 124. perl
# because stock macOS has no timeout(1). <seconds> may be fractional; it must be
# positive, since alarm(0) would mean no bound at all.
run_bounded() {
  perl -MTime::HiRes=alarm -e '
    my $secs = shift;
    $secs > 0 or die "run_bounded: bound must be positive, got $secs\n";
    my $pid = fork() // die "fork: $!\n";
    if ($pid == 0) { setpgrp(0, 0); exec { $ARGV[0] } @ARGV or die "exec $ARGV[0]: $!\n"; }
    sub reap { kill "TERM", -$pid; select(undef, undef, undef, 0.5); kill "KILL", -$pid; waitpid($pid, 0); }
    $SIG{ALRM} = sub { reap(); exit 124 };
    $SIG{INT} = sub { reap(); exit 130 };
    $SIG{TERM} = sub { reap(); exit 143 };
    alarm $secs;
    waitpid($pid, 0);
    alarm 0;
    exit($? & 127 ? 128 + ($? & 127) : $? >> 8);
  ' "$@" </dev/null
}

# The pinned runtime's identifier, or a hard failure naming the install
# command. Never falls back to another installed runtime: a lane silently
# running a different iOS version is the bug this pin exists to prevent.
require_pinned_runtime() {
  local runtime_id=""

  runtime_id="$(boga_ios_sim_runtime_id)" || runtime_id=""
  if [[ -n "$runtime_id" ]]; then
    printf '%s\n' "$runtime_id"
    return 0
  fi

  {
    echo "[ios-sim-boot] FAIL: the pinned iOS simulator runtime '${BOGA_IOS_SIM_RUNTIME}' is not installed."
    echo "  install it:  xcodebuild -downloadPlatform iOS -buildVersion ${BOGA_IOS_SIM_RUNTIME##iOS }"
    echo "  installed iOS runtimes:"
    boga_ios_sim_installed_runtimes | sed 's/^/    /'
    echo "  the pin is BOGA_IOS_SIM_RUNTIME in scripts/worktree-lib.sh; export IOS_SIM_RUNTIME to"
    echo "  target another installed runtime for this run on purpose."
  } >&2
  return 1
}

preferred_device_type() {
  xcrun simctl list devicetypes -j | node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const devices = data.devicetypes ?? [];
    const preferredNames = ["iPhone 17 Pro", "iPhone 16 Pro", "iPhone 15 Pro"];
    for (const name of preferredNames) {
      const match = devices.find((device) => device.name === name && device.identifier);
      if (match) {
        process.stdout.write(match.identifier);
        process.exit(0);
      }
    }
    const fallback = devices.find((device) => /^iPhone/.test(device.name ?? "") && device.identifier);
    if (!fallback) process.exit(1);
    process.stdout.write(fallback.identifier);
  '
}

create_simulator() {
  local device_type_id

  device_type_id="$(preferred_device_type)" || {
    echo "Unable to resolve an available iPhone simulator device type." >&2
    return 1
  }

  echo "[maestro] sim \"${IOS_SIM_DEVICE}\" not found — creating it on the pinned ${BOGA_IOS_SIM_RUNTIME} (deviceType=${device_type_id})" >&2
  run_bounded "$IOS_SIM_CREATE_TIMEOUT_SECONDS" xcrun simctl create "$IOS_SIM_DEVICE" "$device_type_id" "$PINNED_RUNTIME_ID"
}

# A lane simulator left on another runtime is disposable: every lane reinstalls
# the dev client and resets app data anyway, so it is deleted and recreated
# under the same name on the pinned runtime, keeping its device type when the
# pin supports it. Reached only for a name matching boga_is_lane_sim_name, so
# another slot's sim, a hand-made one ("BOGA wt10 ios26") and the stock default
# are never deleted.
recreate_on_pinned_runtime() {
  local udid="$1" from_runtime_id="$2" device_type_id="$3"
  local target_type="$device_type_id"

  if [[ -z "$target_type" ]] || ! boga_ios_sim_runtime_supports "$PINNED_RUNTIME_ID" "$target_type"; then
    target_type="$(preferred_device_type)" || {
      echo "Unable to resolve an available iPhone simulator device type." >&2
      return 1
    }
  fi

  echo "[maestro] sim \"${IOS_SIM_DEVICE}\" ($udid) runs $(boga_ios_sim_runtime_label "$from_runtime_id"), not the pinned ${BOGA_IOS_SIM_RUNTIME} — deleting it and recreating it on the pin (deviceType=${target_type})" >&2

  # Shut it down first so a running device is not torn out from under
  # Simulator.app: measured, `simctl delete` does succeed on a booted device,
  # but shutdown-then-delete is the orderly path. Shutting down an
  # already-shutdown device exits non-zero (SimError 405), so of the two only
  # the delete has to succeed.
  run_bounded "$IOS_SIM_CREATE_TIMEOUT_SECONDS" xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  run_bounded "$IOS_SIM_CREATE_TIMEOUT_SECONDS" xcrun simctl delete "$udid" >/dev/null || {
    echo "[ios-sim-boot] FAIL: could not delete simulator \"${IOS_SIM_DEVICE}\" ($udid) to recreate it on ${BOGA_IOS_SIM_RUNTIME}." >&2
    return 1
  }
  run_bounded "$IOS_SIM_CREATE_TIMEOUT_SECONDS" xcrun simctl create "$IOS_SIM_DEVICE" "$target_type" "$PINNED_RUNTIME_ID"
}

SIM_UDID="$IOS_SIM_UDID"
PINNED_RUNTIME_ID=""

# An explicit IOS_SIM_UDID is an operator override: that device is used exactly
# as given, runtime included. Resolving by name is the lane path, and it owns
# the runtime pin.
if [[ -z "$SIM_UDID" ]]; then
  PINNED_RUNTIME_ID="$(require_pinned_runtime)" || exit 1
  DEVICE_FIELDS="$(boga_ios_sim_device "$IOS_SIM_DEVICE" "$PINNED_RUNTIME_ID")"
  if [[ -n "$DEVICE_FIELDS" ]]; then
    IFS=$'\t' read -r SIM_UDID FOUND_RUNTIME_ID FOUND_DEVICE_TYPE <<<"$DEVICE_FIELDS"
    if [[ "$FOUND_RUNTIME_ID" != "$PINNED_RUNTIME_ID" ]]; then
      if boga_is_lane_sim_name "$IOS_SIM_DEVICE"; then
        SIM_UDID="$(recreate_on_pinned_runtime "$SIM_UDID" "$FOUND_RUNTIME_ID" "$FOUND_DEVICE_TYPE")" || exit 1
      else
        echo "[maestro] sim \"${IOS_SIM_DEVICE}\" ($SIM_UDID) runs $(boga_ios_sim_runtime_label "$FOUND_RUNTIME_ID"), not the pinned ${BOGA_IOS_SIM_RUNTIME} — using it as found, because only a slot-named lane sim (BOGA wt<slot>) is ever recreated" >&2
      fi
    fi
  fi
fi

if [[ -z "$SIM_UDID" && "$IOS_SIM_AUTO_CREATE" == "1" ]]; then
  SIM_UDID="$(create_simulator)"
fi

if [[ -z "$SIM_UDID" ]]; then
  echo "Unable to find iOS simulator device '${IOS_SIM_DEVICE}'." >&2
  echo "Set IOS_SIM_AUTO_CREATE=1 to create a dedicated simulator automatically." >&2
  echo "Available devices:" >&2
  xcrun simctl list devices available >&2
  exit 1
fi

if [[ "$MODE" == "--udid-only" ]]; then
  echo "$SIM_UDID"
  exit 0
fi

CRASH_DIR="$HOME/Library/Logs/DiagnosticReports"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ios-sim-boot.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT
# Crash reports newer than this marker were written during this boot attempt.
: > "$WORK_DIR/boot-started"

# SpringBoard crash reports for this device since the boot attempt began. The
# simulator tags each report with coalition com.apple.CoreSimulator.SimDevice.<UDID>.
springboard_crash_reports() {
  [[ -d "$CRASH_DIR" ]] || return 0
  find "$CRASH_DIR" -maxdepth 1 -name 'SpringBoard-*.ips' -newer "$WORK_DIR/boot-started" -print 2>/dev/null \
    | while IFS= read -r report; do
        if grep -qF "SimDevice.$SIM_UDID" "$report" 2>/dev/null; then echo "$report"; fi
      done \
    | sort
}

fail_boot() {
  local reason="$1" state sim_app springboard crashes crash_count newest
  state="$(run_bounded 15 xcrun simctl list devices 2>/dev/null \
    | sed -n "s/.*(${SIM_UDID}) (\\([^)]*\\)).*/\\1/p" | head -n 1 || true)"
  if pgrep -x Simulator >/dev/null 2>&1; then sim_app="running"; else sim_app="NOT running"; fi
  springboard="n/a (device not booted)"
  if [[ "$state" == "Booted" ]]; then
    springboard="$(run_bounded 15 xcrun simctl spawn "$SIM_UDID" launchctl list 2>/dev/null \
      | awk '$3 == "com.apple.SpringBoard" { print ($1 == "-" ? "not running (last exit " $2 ")" : "pid " $1) }' || true)"
  fi
  crashes="$(springboard_crash_reports)"
  crash_count=0
  [[ -z "$crashes" ]] || crash_count="$(printf '%s\n' "$crashes" | wc -l | tr -d ' ')"

  {
    echo "[ios-sim-boot] FAIL: simulator '$IOS_SIM_DEVICE' ($SIM_UDID) did not finish booting: $reason"
    echo "  device state:  ${state:-unknown (simctl list gave no state)}"
    echo "  Simulator.app: $sim_app"
    echo "  SpringBoard:   ${springboard:-unknown (simctl spawn launchctl list failed or timed out)}"
    echo "  SpringBoard crash reports for this device since boot began: $crash_count"
    if (( crash_count > 0 )); then
      newest="$(printf '%s\n' "$crashes" | tail -n 1)"
      echo "    newest: $newest"
      echo "  diagnosis: SpringBoard is crash-looping inside the simulator, so boot never completes."
      if grep -qF "FBSDisplayMonitor" "$newest" 2>/dev/null; then
        echo "    It dies in FBSDisplayMonitor during +[FBDisplayManager sharedInstance]: the simulator could not initialise a display."
      fi
    elif [[ "$state" != "Booted" ]]; then
      echo "  diagnosis: the device never reached the Booted state."
    else
      echo "  diagnosis: the device is Booted but never reported boot-complete, with no SpringBoard crash reports."
    fi
    if [[ -s "$WORK_DIR/bootstatus.err" ]]; then
      echo "  last simctl output:"
      sed 's/^/    /' "$WORK_DIR/bootstatus.err" | tail -n 5
    fi
    echo "  remediation (the device is left as-is for inspection):"
    echo "    xcrun simctl shutdown $SIM_UDID"
    echo "    open -a Simulator"
    echo "    then re-run the gate; if it still fails, xcrun simctl erase $SIM_UDID"
  } >&2
  exit 1
}

# The deadline is wall-clock with sub-second resolution. Not bash SECONDS: that
# is time(NULL) minus its start, so a boot that merely crosses a second boundary
# reads as a whole second spent and could leave no budget for bootstatus. Stock
# macOS bash 3.2 has no EPOCHREALTIME, hence perl.
DEADLINE="$(perl -MTime::HiRes=time -e 'printf "%.3f\n", time + shift' "$IOS_SIM_BOOT_TIMEOUT_SECONDS")"

# Seconds left before DEADLINE (millisecond resolution); prints nothing once spent.
remaining_budget() {
  perl -MTime::HiRes=time -e 'my $left = shift() - time; printf "%.3f\n", $left if $left >= 0.001' "$DEADLINE"
}

rc=0
run_bounded "$IOS_SIM_BOOT_TIMEOUT_SECONDS" xcrun simctl boot "$SIM_UDID" >/dev/null 2>"$WORK_DIR/bootstatus.err" || rc=$?
# A non-zero boot is normal for an already-booted device; only a hang fails here.
if (( rc == 124 )); then
  fail_boot "simctl boot did not return within ${IOS_SIM_BOOT_TIMEOUT_SECONDS}s"
fi

# Retry fast failures (transient simctl errors); a timeout is final, since a
# second blocking wait would only keep waiting on the same stuck boot.
BOOT_READY=false
rc=none
for _ in 1 2 3 4 5 6; do
  budget="$(remaining_budget)"
  [[ -n "$budget" ]] || break
  rc=0
  run_bounded "$budget" xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null 2>"$WORK_DIR/bootstatus.err" || rc=$?
  if (( rc == 0 )); then
    BOOT_READY=true
    break
  fi
  if (( rc == 124 )); then
    fail_boot "simctl bootstatus did not report boot-complete within ${IOS_SIM_BOOT_TIMEOUT_SECONDS}s"
  fi
  sleep 2
done

if [[ "$rc" == none ]]; then
  fail_boot "simctl boot returned with none of the ${IOS_SIM_BOOT_TIMEOUT_SECONDS}s left for simctl bootstatus"
fi
if [[ "$BOOT_READY" != true ]]; then
  fail_boot "simctl bootstatus kept failing (last exit $rc) within ${IOS_SIM_BOOT_TIMEOUT_SECONDS}s"
fi

echo "$SIM_UDID"
