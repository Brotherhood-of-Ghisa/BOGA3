#!/usr/bin/env bash
# shellcheck disable=SC2016  # assert conditions are single-quoted on purpose: eval expands them later
# ios-sim-boot.sh boot-wait AND iOS-runtime pin against stub xcrun/pgrep: no
# simulator, Xcode or slot lease needed. Guards the 2026-09-22 hang, where
# `simctl bootstatus -b` blocked forever on a device whose SpringBoard was
# crash-looping, and the 2026-10-07 per-slot runtime drift, where a slot sim
# created on an older runtime kept running lanes on it (26.2 vs 27.0 label the
# native back button differently, so flows failed as if flaky).
set -euo pipefail
SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOOT_SCRIPT="$SRC_ROOT/apps/mobile/scripts/ios-sim-boot.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
UDID="11111111-2222-3333-4444-555555555555"
OTHER_UDID="99999999-8888-7777-6666-555555555555"
# The runtime-pin fixtures: this slot's lane sim, plus the devices the script
# must never delete — another slot's lane sim, a hand-made variant of this
# slot's name, and the simulator a bare `simctl create` would hand back.
SLOT_NAME="BOGA wt3"
SLOT_UDID="aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa"
OTHER_SLOT_UDID="bbbbbbbb-2222-2222-2222-bbbbbbbbbbbb"
HANDMADE_UDID="cccccccc-3333-3333-3333-cccccccccccc"
STOCK_UDID="dddddddd-4444-4444-4444-dddddddddddd"
NEW_UDID="eeeeeeee-5555-5555-5555-eeeeeeeeeeee"
DUP_UDID="ffffffff-6666-6666-6666-ffffffffffff"
RT26="com.apple.CoreSimulator.SimRuntime.iOS-26-2"
RT27="com.apple.CoreSimulator.SimRuntime.iOS-27-0"
TYPE17="com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro"
TYPE16="com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro"
TYPE13="com.apple.CoreSimulator.SimDeviceType.iPhone-13"
export STUB_LOG="$WORK/calls.log" STUB_STATE="$WORK/state" UDID OTHER_UDID
export SLOT_NAME SLOT_UDID OTHER_SLOT_UDID HANDMADE_UDID STOCK_UDID NEW_UDID DUP_UDID
export RT26 RT27 TYPE17 TYPE16 TYPE13
mkdir -p "$WORK/bin" "$WORK/home" "$STUB_STATE"

cat > "$WORK/bin/xcrun" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$STUB_LOG"
case "$*" in
  "simctl list devices -j")
    # The slot sim sits on STUB_SIM_RUNTIME (default: the stale 26.2); the other
    # three names are decoys that must survive every run.
    node -e '
      const [rt26, rt27, type17] = [process.env.RT26, process.env.RT27, process.env.TYPE17];
      const device = (udid, name, deviceTypeIdentifier = type17) =>
        ({ udid, name, isAvailable: true, state: "Shutdown", deviceTypeIdentifier });
      const devices = { [rt26]: [], [rt27]: [] };
      if (process.env.STUB_SIM_PRESENT !== "0") {
        devices[process.env.STUB_SIM_RUNTIME || rt26].push(
          device(process.env.SLOT_UDID, process.env.SLOT_NAME, process.env.STUB_SIM_TYPE || type17),
        );
      }
      if (process.env.STUB_SIM_DUPLICATE === "1") {
        devices[rt27].push(device(process.env.DUP_UDID, process.env.SLOT_NAME));
      }
      devices[rt26].push(device(process.env.OTHER_SLOT_UDID, "BOGA wt4"));
      devices[rt26].push(device(process.env.HANDMADE_UDID, `${process.env.SLOT_NAME} ios26`));
      devices[rt26].push(device(process.env.STOCK_UDID, "iPhone 17 Pro"));
      devices[rt26].push(device(process.env.UDID, "BOGA test"));
      process.stdout.write(JSON.stringify({ devices }));
    ' ;;
  "simctl list runtimes -j")
    # STUB_RUNTIMES=only26 leaves the pinned runtime uninstalled. iPhone 13 is
    # supported on 26.2 only, so a stale sim of that type cannot keep its type.
    node -e '
      const runtime = (name, identifier, types) =>
        ({ name, identifier, version: name.replace("iOS ", ""), isAvailable: true,
           supportedDeviceTypes: types.map((identifier) => ({ identifier })) });
      const runtimes = [
        runtime("iOS 26.2", process.env.RT26, [process.env.TYPE17, process.env.TYPE16, process.env.TYPE13]),
      ];
      if (process.env.STUB_RUNTIMES !== "only26") {
        runtimes.push(runtime("iOS 27.0", process.env.RT27, [process.env.TYPE17, process.env.TYPE16]));
      }
      process.stdout.write(JSON.stringify({ runtimes }));
    ' ;;
  "simctl list devicetypes -j")
    node -e '
      process.stdout.write(JSON.stringify({ devicetypes: [
        { name: "iPhone 17 Pro", identifier: process.env.TYPE17 },
        { name: "iPhone 16 Pro", identifier: process.env.TYPE16 },
      ] }));
    ' ;;
  "simctl list devices"*) printf -- '-- iOS 26.2 --\n    BOGA test (%s) (%s) \n' "$UDID" "${STUB_DEVICE_STATE:-Booted}" ;;
  "simctl shutdown "*) exit "${STUB_SHUTDOWN_EXIT:-0}" ;;
  "simctl delete "*) exit "${STUB_DELETE_EXIT:-0}" ;;
  "simctl create "*) printf '%s\n' "$NEW_UDID" ;;
  "simctl boot "*)
    # cross-second: return 50ms past the next wall-clock second boundary, so a
    # whole-second clock (bash SECONDS) reads this short boot as a 1s budget spent.
    if [[ "${STUB_BOOT:-}" == cross-second ]]; then
      perl -MTime::HiRes=time,sleep -e 'sleep(int(time) + 1.05 - time)'
    fi
    exit 0 ;;
  "simctl spawn "*) printf 'PID\tStatus\tLabel\n-\t5\tcom.apple.SpringBoard\n' ;;
  "simctl bootstatus "*)
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

# The lane path: no IOS_SIM_UDID, so the script resolves <name> itself and owns
# the runtime pin. First arg is the configured IOS_SIM_DEVICE.
run_boot_by_name() {
  local name="$1"; shift
  : > "$STUB_LOG"
  rm -rf "${STUB_STATE:?}"/* "$WORK/home/Library"
  rc=0
  out="$(env PATH="$WORK/bin:$PATH" HOME="$WORK/home" IOS_SIM_DEVICE="$name" IOS_SIM_AUTO_CREATE=1 \
    "$@" "$BOOT_SCRIPT" 2>"$WORK/stderr")" || rc=$?
}
assert_untouched() {
  if grep -qE "simctl (delete|shutdown|create|boot|erase) ($OTHER_SLOT_UDID|$HANDMADE_UDID|$STOCK_UDID)" "$STUB_LOG"; then
    echo "FAIL: $1 — the script touched another simulator:" >&2; cat "$STUB_LOG" >&2; exit 1
  fi
  PASS=$((PASS + 1))
}

# 1. Normal boot: prints the UDID. An explicit IOS_SIM_UDID is an operator
#    override, so the runtime pin is not resolved or enforced at all.
run_boot STUB_BOOTSTATUS=ok
assert '[[ $rc == 0 && $out == "$UDID" ]]' "ready device prints its UDID (rc=$rc out=$out)"
assert '! grep -q "simctl list runtimes" "$STUB_LOG"' "an explicit IOS_SIM_UDID never queries the pinned runtime"
assert '! grep -q "simctl delete" "$STUB_LOG"' "an explicit IOS_SIM_UDID is never deleted"

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

# ---------- the iOS runtime pin (lane path: resolve by name) ----------

# 6. The slot sim already runs the pinned runtime: boot it, delete nothing.
run_boot_by_name "$SLOT_NAME" STUB_BOOTSTATUS=ok STUB_SIM_RUNTIME="$RT27"
assert '[[ $rc == 0 && $out == "$SLOT_UDID" ]]' "a slot sim on the pinned runtime is reused (rc=$rc out=$out)"
assert '! grep -qE "simctl (delete|create)" "$STUB_LOG"' "a matching slot sim is never recreated"
assert '[[ $(grep -c "simctl boot $SLOT_UDID" "$STUB_LOG") == 1 ]]' "the matching slot sim is the one booted"

# 7. The slot sim runs an older runtime: shut down, delete, recreate on the pin
#    under the same name, keeping its device type, then boot the NEW device.
run_boot_by_name "$SLOT_NAME" STUB_BOOTSTATUS=ok STUB_SIM_RUNTIME="$RT26" STUB_SIM_TYPE="$TYPE16"
assert '[[ $rc == 0 && $out == "$NEW_UDID" ]]' "a stale slot sim is recreated and the new UDID returned (rc=$rc out=$out)"
assert_err "runs iOS 26.2, not the pinned iOS 27.0"
assert_err "deleting it and recreating it on the pin"
assert '[[ $(grep -c "simctl shutdown $SLOT_UDID" "$STUB_LOG") == 1 ]]' "the stale sim is shut down before it is deleted"
assert 'grep -n "simctl shutdown $SLOT_UDID" "$STUB_LOG" | cut -d: -f1 | head -n 1 |
  xargs -I{} test {} -lt "$(grep -n "simctl delete $SLOT_UDID" "$STUB_LOG" | cut -d: -f1 | head -n 1)"' \
  "shutdown is logged before delete"
assert '[[ $(grep -c "simctl delete $SLOT_UDID" "$STUB_LOG") == 1 ]]' "the stale sim is deleted"
assert 'grep -qF "simctl create $SLOT_NAME $TYPE16 $RT27" "$STUB_LOG"' \
  "recreated under the same name and device type, on the pinned runtime"
assert '[[ $(grep -c "simctl boot $NEW_UDID" "$STUB_LOG") == 1 ]]' "the recreated sim is the one booted"
assert_untouched "recreate"

# 8. Same, but the stale sim's device type does not exist on the pinned runtime:
#    fall back to the preferred iPhone instead of failing the create.
run_boot_by_name "$SLOT_NAME" STUB_BOOTSTATUS=ok STUB_SIM_RUNTIME="$RT26" STUB_SIM_TYPE="$TYPE13"
assert '[[ $rc == 0 && $out == "$NEW_UDID" ]]' "a stale sim of an unsupported type is still recreated (rc=$rc)"
assert 'grep -qF "simctl create $SLOT_NAME $TYPE17 $RT27" "$STUB_LOG"' \
  "a device type the pinned runtime lacks falls back to the preferred iPhone"

# 9. The pinned runtime is not installed: fail loud with the install command,
#    and never fall back to the older runtime that IS installed.
run_boot_by_name "$SLOT_NAME" STUB_BOOTSTATUS=ok STUB_SIM_RUNTIME="$RT26" STUB_RUNTIMES=only26
assert '[[ $rc == 1 && -z $out ]]' "a missing pinned runtime fails the run (rc=$rc out=$out)"
assert_err "the pinned iOS simulator runtime 'iOS 27.0' is not installed"
assert_err "xcodebuild -downloadPlatform iOS -buildVersion 27.0"
assert_err "iOS 26.2"
assert_err "BOGA_IOS_SIM_RUNTIME in scripts/worktree-lib.sh"
assert '! grep -qE "simctl (delete|create|boot)" "$STUB_LOG"' "a missing pinned runtime deletes and creates nothing"
assert_untouched "missing pinned runtime"

# 10. No slot sim yet: auto-create it on the pinned runtime, not on the newest
#     installed one (26.2 is newer in no sense, but the old code took whatever
#     sorted first — here the assertion is simply that the pin is used).
run_boot_by_name "$SLOT_NAME" STUB_BOOTSTATUS=ok STUB_SIM_PRESENT=0
assert '[[ $rc == 0 && $out == "$NEW_UDID" ]]' "a missing slot sim is created (rc=$rc out=$out)"
assert_err "not found — creating it on the pinned iOS 27.0"
assert 'grep -qF "simctl create $SLOT_NAME $TYPE17 $RT27" "$STUB_LOG"' "the created sim is on the pinned runtime"
assert '! grep -q "simctl delete" "$STUB_LOG"' "creating a missing sim deletes nothing"
assert_untouched "auto-create"

# 11. A name that is not a slot lane sim (the stock default) is used as found on
#     whatever runtime it has — deleting a human's own simulator is never ours
#     to do. Same for a hand-made "BOGA wt3 ios26".
run_boot_by_name "iPhone 17 Pro" STUB_BOOTSTATUS=ok STUB_SIM_RUNTIME="$RT26"
assert '[[ $rc == 0 && $out == "$STOCK_UDID" ]]' "a non-lane sim on another runtime is used as found (rc=$rc out=$out)"
assert_err "using it as found, because only a slot-named lane sim"
assert '! grep -qE "simctl (delete|create)" "$STUB_LOG"' "a non-lane sim is never deleted or recreated"

run_boot_by_name "$SLOT_NAME ios26" STUB_BOOTSTATUS=ok STUB_SIM_RUNTIME="$RT26"
assert '[[ $rc == 0 && $out == "$HANDMADE_UDID" ]]' "a hand-made sim is used as found (rc=$rc out=$out)"
assert '! grep -qE "simctl (delete|create)" "$STUB_LOG"' "a hand-made sim is never deleted or recreated"

# 12. The same name exists on both runtimes (a sim was created on the pin while
#     the stale one survived): take the one already on the pin and delete
#     neither — a stale duplicate is nobody's to collect here.
run_boot_by_name "$SLOT_NAME" STUB_BOOTSTATUS=ok STUB_SIM_RUNTIME="$RT26" STUB_SIM_DUPLICATE=1
assert '[[ $rc == 0 && $out == "$DUP_UDID" ]]' "a duplicate name resolves to the sim on the pinned runtime (rc=$rc out=$out)"
assert '! grep -qE "simctl (delete|create)" "$STUB_LOG"' "a duplicate name deletes nothing"
assert '! grep -q "$SLOT_UDID" "$STUB_LOG"' "the stale duplicate is left alone"

# 13. A delete that fails must fail the run, not boot the stale sim anyway.
run_boot_by_name "$SLOT_NAME" STUB_BOOTSTATUS=ok STUB_SIM_RUNTIME="$RT26" STUB_DELETE_EXIT=1
assert '[[ $rc == 1 && -z $out ]]' "a failed delete fails the run (rc=$rc out=$out)"
assert_err "could not delete simulator"
assert '! grep -q "simctl boot" "$STUB_LOG"' "nothing is booted when the recreate could not complete"

echo "ios-sim-boot.test.sh: ${PASS} assertions passed"
