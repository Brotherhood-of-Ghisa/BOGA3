#!/usr/bin/env bash
# shellcheck disable=SC2016  # assert conditions are single-quoted on purpose: eval expands them later
# ios-sim-boot.sh boot-wait against stub xcrun/pgrep: no simulator, Xcode or
# slot lease needed. Guards the 2026-09-22 hang, where `simctl bootstatus -b`
# blocked forever on a device whose SpringBoard was crash-looping.
set -euo pipefail
SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOOT_SCRIPT="$SRC_ROOT/apps/mobile/scripts/ios-sim-boot.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
UDID="11111111-2222-3333-4444-555555555555"
OTHER_UDID="99999999-8888-7777-6666-555555555555"
export STUB_LOG="$WORK/calls.log" STUB_STATE="$WORK/state" UDID OTHER_UDID
mkdir -p "$WORK/bin" "$WORK/home" "$STUB_STATE"

cat > "$WORK/bin/xcrun" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_LOG"
case "$1 $2" in
  "simctl list") printf -- '-- iOS 26.2 --\n    BOGA test (%s) (%s) \n' "$UDID" "${STUB_DEVICE_STATE:-Booted}" ;;
  "simctl boot")
    # cross-second: return 50ms past the next wall-clock second boundary, so a
    # whole-second clock (bash SECONDS) reads this short boot as a 1s budget spent.
    if [[ "${STUB_BOOT:-}" == cross-second ]]; then
      perl -MTime::HiRes=time,sleep -e 'sleep(int(time) + 1.05 - time)'
    fi
    exit 0 ;;
  "simctl spawn") printf 'PID\tStatus\tLabel\n-\t5\tcom.apple.SpringBoard\n' ;;
  "simctl bootstatus")
    case "$STUB_BOOTSTATUS" in
      ok) exit 0 ;;
      fail-once)
        [[ -f "$STUB_STATE/failed" ]] && exit 0
        : > "$STUB_STATE/failed"; echo "transient simctl error" >&2; exit 3 ;;
      crash-loop|hang)
        # crash-loop: SpringBoard dies twice while we wait (plus one report from
        # another device, which must not be counted). Either way boot never completes.
        reports="$HOME/Library/Logs/DiagnosticReports"
        if [[ "$STUB_BOOTSTATUS" == crash-loop ]]; then
          mkdir -p "$reports"
          printf '{"coalitionName" : "com.apple.CoreSimulator.SimDevice.%s"}\n' "$UDID" > "$reports/SpringBoard-1.ips"
          printf '{"coalitionName" : "com.apple.CoreSimulator.SimDevice.%s", "symbol":"-[FBSDisplayMonitor _initWithBookendObserver:transformer:]"}\n' "$UDID" > "$reports/SpringBoard-2.ips"
          printf '{"coalitionName" : "com.apple.CoreSimulator.SimDevice.%s"}\n' "$OTHER_UDID" > "$reports/SpringBoard-3.ips"
        fi
        echo "$$" > "$STUB_STATE/bootstatus.pid"
        exec sleep 300 ;;
    esac ;;
esac
STUB
cat > "$WORK/bin/pgrep" <<'STUB'
#!/usr/bin/env bash
exit "${STUB_PGREP_EXIT:-1}"
STUB
chmod +x "$WORK/bin/xcrun" "$WORK/bin/pgrep"

PASS=0
assert() {
  if eval "$1"; then PASS=$((PASS + 1)); else echo "FAIL: $2" >&2; cat "$WORK/stderr" >&2; exit 1; fi
}
assert_err() {
  grep -qF -- "$1" "$WORK/stderr" || { echo "FAIL: stderr missing '$1'" >&2; cat "$WORK/stderr" >&2; exit 1; }
  PASS=$((PASS + 1))
}
run_boot() {
  : > "$STUB_LOG"
  rm -rf "${STUB_STATE:?}"/* "$WORK/home/Library"
  rc=0
  started=$SECONDS
  out="$(env PATH="$WORK/bin:$PATH" HOME="$WORK/home" IOS_SIM_UDID="$UDID" IOS_SIM_DEVICE="BOGA test" \
    "$@" "$BOOT_SCRIPT" 2>"$WORK/stderr")" || rc=$?
  elapsed=$((SECONDS - started))
}

# 1. Normal boot: prints the UDID.
run_boot STUB_BOOTSTATUS=ok
assert '[[ $rc == 0 && $out == "$UDID" ]]' "ready device prints its UDID (rc=$rc out=$out)"

# 2. A fast transient bootstatus failure is still retried.
run_boot STUB_BOOTSTATUS=fail-once
assert '[[ $rc == 0 && $out == "$UDID" ]]' "transient failure is retried (rc=$rc)"
assert '[[ $(grep -c "simctl bootstatus" "$STUB_LOG") == 2 ]]' "bootstatus retried exactly once"

# 3. A boot that never completes fails within the deadline with the diagnosis,
#    and the blocked bootstatus is killed rather than orphaned.
run_boot STUB_BOOTSTATUS=crash-loop STUB_PGREP_EXIT=1 IOS_SIM_BOOT_TIMEOUT_SECONDS=1
assert '[[ $rc == 1 && -z $out ]]' "wedged boot fails (rc=$rc)"
assert '(( elapsed <= 10 ))' "wedged boot fails near the 1s deadline, not after ${elapsed}s"
assert '[[ $(grep -c "simctl bootstatus" "$STUB_LOG") == 1 ]]' "a timed-out bootstatus is not retried"
assert '[[ -s $STUB_STATE/bootstatus.pid ]] && ! kill -0 "$(cat "$STUB_STATE/bootstatus.pid")" 2>/dev/null' \
  "timed-out bootstatus process was killed"
assert_err "did not finish booting: simctl bootstatus did not report boot-complete within 1s"
assert_err "($UDID)"
assert_err "device state:  Booted"
assert_err "Simulator.app: NOT running"
assert_err "SpringBoard:   not running (last exit 5)"
assert_err "SpringBoard crash reports for this device since boot began: 2"
assert_err "SpringBoard is crash-looping"
assert_err "could not initialise a display"
assert_err "xcrun simctl shutdown $UDID"

# 4. Same timeout on a device that never left Shutdown, with Simulator.app up.
run_boot STUB_BOOTSTATUS=hang STUB_PGREP_EXIT=0 STUB_DEVICE_STATE=Shutdown IOS_SIM_BOOT_TIMEOUT_SECONDS=1
assert '[[ $rc == 1 ]]' "shutdown wedge fails (rc=$rc)"
assert_err "device state:  Shutdown"
assert_err "Simulator.app: running"
assert_err "SpringBoard:   n/a (device not booted)"
assert_err "SpringBoard crash reports for this device since boot began: 0"
assert_err "the device never reached the Booted state"

# 5. A short boot that crosses a second boundary still leaves the rest of a 1s
#    deadline to one bounded bootstatus, which times out with its own message.
#    Start 0.25s past a boundary so the stub's sleep (to the next one) stays
#    well inside the 1s bound on simctl boot.
perl -MTime::HiRes=time,sleep -e 'sleep(int(time) + 1.25 - time)'
run_boot STUB_BOOT=cross-second STUB_BOOTSTATUS=hang IOS_SIM_BOOT_TIMEOUT_SECONDS=1
assert '[[ $rc == 1 && -z $out ]]' "cross-second boot then wedged bootstatus fails (rc=$rc)"
assert '[[ $(grep -c "simctl bootstatus" "$STUB_LOG") == 1 ]]' "bootstatus runs once after a boot that crossed a second boundary"
assert '[[ -s $STUB_STATE/bootstatus.pid ]] && ! kill -0 "$(cat "$STUB_STATE/bootstatus.pid")" 2>/dev/null' \
  "cross-second case: timed-out bootstatus process was killed"
assert_err "did not finish booting: simctl bootstatus did not report boot-complete within 1s"

echo "ios-sim-boot.test.sh: ${PASS} assertions passed"
