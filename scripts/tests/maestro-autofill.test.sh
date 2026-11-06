#!/usr/bin/env bash
# Real iOS runners/provision/helper, stub native tools: preparation must finish
# before app install/launch, including shared sessions and failure cleanup.
set -euo pipefail
SRC_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export AUTOFILL_RUNTIME="$SRC_ROOT/apps/mobile/scripts/maestro-ios-runtime.sh"
export STUB_LOG="$WORK/calls" STUB_STATE="$WORK/state"
export STUB_UDID=11111111-2222-3333-4444-555555555555
APP="$WORK/apps/mobile"
SCRIPTS="$APP/scripts"
mkdir -p "$SCRIPTS" "$WORK/bin" "$WORK/supabase/scripts" "$APP/.maestro/flows"
cp "$SRC_ROOT"/apps/mobile/scripts/maestro-ios-{provision,run-flow,run-flows,teardown}.sh "$SCRIPTS/"
cp "$SRC_ROOT/apps/mobile/scripts/maestro-ios-autofill.js" "$SCRIPTS/"
cat > "$SCRIPTS/maestro-ios-runtime.sh" <<'STUB'
source "$AUTOFILL_RUNTIME"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
maestro_source_env() { :; }
maestro_dev_client_bundle_id() { echo test.app; }
maestro_dev_client_executable_name() { echo Test; }
maestro_simulator_name_for_udid() { echo 'BOGA same name'; }
maestro_capture_simulator_logs() { :; }
maestro_collect_crash_reports() { :; }
STUB
printf '#!/usr/bin/env bash\necho /tmp/Test.app\n' > "$SCRIPTS/maestro-ios-dev-client-build.sh"
printf '#!/usr/bin/env bash\necho "$STUB_UDID"\n' > "$SCRIPTS/ios-sim-boot.sh"
printf '#!/usr/bin/env bash\necho launch >> "$STUB_LOG"\n' > "$SCRIPTS/maestro-ios-launch.sh"
printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/bin/open"
cat > "$WORK/bin/xcrun" <<'STUB'
#!/usr/bin/env bash
echo "$*" >> "$STUB_LOG"
STUB
cat > "$WORK/bin/maestro" <<'STUB'
#!/usr/bin/env bash
echo "maestro $*" >> "$STUB_LOG"
if [[ "${3:-}" == hierarchy ]]; then
  state="$(cat "$STUB_STATE")"
  value=1 checked=true
  [[ "$state" != off ]] || { value=0; checked=false; }
  [[ "$state" != unreadable ]] || value=''
  printf '{"attributes":{"resource-id":"AutoFillToggle","enabled":"true","value":"%s","checked":"%s"}}\n' "$value" "$checked"
elif [[ "$*" == *disable.yaml* ]]; then
  echo off > "$STUB_STATE"
elif [[ "$*" == *product.yaml* ]]; then
  echo product >> "$STUB_LOG"
fi
STUB
chmod +x "$SCRIPTS/"*.sh "$WORK/bin/"*
export PATH="$WORK/bin:$PATH"
export EXPO_DEV_SERVER_PORT=8085 TASK_ID=stub MAESTRO_RESET_STRATEGY=full
export MAESTRO_IOS_REQUIRE_AUTOFILL_OFF=1
printf 'appId: test.app\n---\n- launchApp\n' > "$APP/.maestro/flows/product.yaml"

fail() { echo "FAIL: $*" >&2; cat "$WORK/output"; exit 1; }
run_case() {
  local runner="$1" state="$2" expected="$3" rc=0
  : > "$STUB_LOG"
  echo "$state" > "$STUB_STATE"
  # Resolve by name, so only provision learns the UDID. Its failure must still
  # persist that identity for the parent runner's real teardown.
  unset IOS_SIM_UDID
  export IOS_SIM_DEVICE='BOGA same name'
  if [[ "$runner" == run-flow ]]; then
    "$SCRIPTS/maestro-ios-run-flow.sh" --scenario test --flow "$APP/.maestro/flows/product.yaml" > "$WORK/output" 2>&1 || rc=$?
  else
    "$SCRIPTS/maestro-ios-run-flows.sh" --session test --flow "$APP/.maestro/flows/product.yaml" > "$WORK/output" 2>&1 || rc=$?
  fi
  if [[ "$expected" == pass ]]; then
    [[ "$rc" == 0 ]] || fail "$runner/$state failed"
    grep -q '^product$' "$STUB_LOG" || fail 'product flow did not run'
    awk '/hierarchy/ { readback=NR } /simctl install/ { if (!readback || NR < readback) exit 1; install=NR } /^launch$/ { if (!install) exit 1; launch=NR } /^product$/ { if (!launch) exit 1 }' "$STUB_LOG" || fail 'preparation must precede install, launch and product'
    if [[ "$state" == on ]]; then
      grep -q disable.yaml "$STUB_LOG" || fail 'on switch not toggled'
    else
      ! grep -q disable.yaml "$STUB_LOG" || fail 'off switch toggled'
    fi
  else
    [[ "$rc" != 0 ]] || fail 'unreadable setup passed'
    ! grep -Eq '^launch$|^product$|simctl install' "$STUB_LOG" || fail 'failed setup reached app'
    grep -q 'failure-hierarchy' "$WORK/output" || grep -q 'AutoFill setup failed' "$WORK/output" || fail 'no recovery diagnostics'
  fi
  grep -q "simctl shutdown $STUB_UDID" "$STUB_LOG" || fail 'cleanup lost resolved UDID'
}
for runner in run-flow run-flows; do
  run_case "$runner" on pass
  run_case "$runner" off pass
  run_case "$runner" unreadable fail
done

# Exercise the real lane arms without provisioning Supabase or a device.
cp "$SRC_ROOT/apps/mobile/scripts/maestro-run-lane.sh" "$SCRIPTS/"
printf '#!/usr/bin/env bash\necho "required=$MAESTRO_IOS_REQUIRE_AUTOFILL_OFF"\n' > "$SCRIPTS/maestro-ios-run-flow.sh"
for script in ensure-local-runtime-baseline sync-e2e-fixture-reset groups-fixture-reset; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$WORK/supabase/scripts/$script.sh"
done
printf 'load_supabase_status_env() { API_URL=http://fixture; ANON_KEY=fixture; }\n' > "$WORK/supabase/scripts/_common.sh"
mkdir -p "$WORK/scripts"
printf 'boga_runtime_guard_script() { :; }\n' > "$WORK/scripts/runtime-guard.sh"
printf 'USER_A_EMAIL=a\nUSER_A_PASSWORD=a\nUSER_B_EMAIL=b\nUSER_B_PASSWORD=b\nUSER_C_EMAIL=c\nUSER_C_PASSWORD=c\nUSER_C_USERNAME=c\nUSER_D_EMAIL=d\nUSER_D_PASSWORD=d\nUSER_D_USERNAME=d\n' > "$WORK/supabase/scripts/auth-fixture-constants.sh"
chmod +x "$WORK/supabase/scripts/"*.sh
for lane in auth-profile sync-e2e groups-e2e; do
  output="$("$SCRIPTS/maestro-run-lane.sh" "$lane")"
  [[ "$output" == *required=1* ]] || fail "$lane bypasses AutoFill preflight"
done
output="$("$SCRIPTS/maestro-run-lane.sh" smoke)"
[[ "$output" == *required=0* ]] || fail 'infra-free lane inherited auth preparation'
echo 'maestro-autofill: runner ordering, failure cleanup and lane wiring passed'
