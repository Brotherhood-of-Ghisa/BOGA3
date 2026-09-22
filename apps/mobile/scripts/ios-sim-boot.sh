#!/usr/bin/env bash
set -euo pipefail

IOS_SIM_DEVICE="${IOS_SIM_DEVICE:-iPhone 17 Pro}"
IOS_SIM_UDID="${IOS_SIM_UDID:-}"
IOS_SIM_AUTO_CREATE="${IOS_SIM_AUTO_CREATE:-0}"
# Hard deadline for boot + boot-ready. `simctl bootstatus -b` blocks until boot
# completes, so a device that never finishes booting (e.g. SpringBoard
# crash-looping) would otherwise hang the gate forever. Measured cold boot is
# seconds; a freshly created device's first boot is well under a minute.
IOS_SIM_BOOT_TIMEOUT_SECONDS="${IOS_SIM_BOOT_TIMEOUT_SECONDS:-120}"
MODE="${1:-boot}"

# run_bounded <seconds> <cmd...>: run cmd in its own process group; on timeout
# TERM then KILL the whole group (no orphaned simctl) and return 124. perl
# because stock macOS has no timeout(1).
run_bounded() {
  perl -e '
    my $secs = shift;
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

find_udid() {
  xcrun simctl list devices available \
    | sed -n "s/^[[:space:]]*${IOS_SIM_DEVICE//\//\\/} (\\([^)]*\\)).*/\\1/p" \
    | head -n 1
}

preferred_runtime() {
  xcrun simctl list runtimes -j | node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const runtimes = (data.runtimes ?? [])
      .filter((runtime) => runtime.isAvailable && /^iOS/.test(runtime.name ?? ""));
    runtimes.sort((a, b) => {
      const av = String(a.version ?? "").split(".").map(Number);
      const bv = String(b.version ?? "").split(".").map(Number);
      for (let i = 0; i < Math.max(av.length, bv.length); i += 1) {
        const delta = (bv[i] ?? 0) - (av[i] ?? 0);
        if (delta !== 0) return delta;
      }
      return String(b.name ?? "").localeCompare(String(a.name ?? ""));
    });
    if (!runtimes[0]?.identifier) process.exit(1);
    process.stdout.write(runtimes[0].identifier);
  '
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
  local runtime_id device_type_id

  runtime_id="$(preferred_runtime)" || {
    echo "Unable to resolve an available iOS simulator runtime." >&2
    return 1
  }
  device_type_id="$(preferred_device_type)" || {
    echo "Unable to resolve an available iPhone simulator device type." >&2
    return 1
  }

  echo "[maestro] sim \"${IOS_SIM_DEVICE}\" not found — creating (deviceType=${device_type_id}, runtime=${runtime_id})" >&2
  xcrun simctl create "$IOS_SIM_DEVICE" "$device_type_id" "$runtime_id"
}

SIM_UDID="$IOS_SIM_UDID"

if [[ -z "$SIM_UDID" ]]; then
  SIM_UDID="$(find_udid)"
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

remaining_budget() {
  echo $(( IOS_SIM_BOOT_TIMEOUT_SECONDS - SECONDS ))
}

SECONDS=0
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
  (( budget > 0 )) || break
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

if [[ "$BOOT_READY" != true ]]; then
  fail_boot "simctl bootstatus kept failing (last exit $rc) within ${IOS_SIM_BOOT_TIMEOUT_SECONDS}s"
fi

echo "$SIM_UDID"
