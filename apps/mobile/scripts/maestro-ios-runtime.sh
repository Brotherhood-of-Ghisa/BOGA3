#!/usr/bin/env bash

# maestro-ios-runtime.sh — iOS-specific Maestro runtime helpers. Sourced, never
# run. The platform-neutral helpers (artifact paths, runtime-state persistence,
# Metro probing, flow-copy rewriting, managed .env.local) live in
# maestro-runtime.sh, which this file sources; everything here is iOS-only:
# simulator control, native permission and URL-scheme pre-authorization,
# dev-menu seeding, and simulator/crash log capture.
#
# Contract: docs/specs/11-maestro-runtime-and-testing-conventions.md.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/maestro-runtime.sh"

maestro_runtime_keys() {
  cat <<'EOF'
TASK_ID
MAESTRO_SESSION_TIMESTAMP
MAESTRO_SCENARIO_NAME
MAESTRO_RUNNER_PID
MAESTRO_ARTIFACT_ROOT
MAESTRO_RUNTIME_ENV_FILE
MAESTRO_FLOW_SOURCE_FILE
MAESTRO_FLOW_FILE
MAESTRO_OUTPUT_DIR
MAESTRO_DEBUG_DIR
MAESTRO_JUNIT_FILE
PROVISION_LOG_FILE
LAUNCH_LOG_FILE
TEARDOWN_LOG_FILE
EXPO_LOG_FILE
MAESTRO_RESET_STRATEGY
IOS_SIM_DEVICE
IOS_SIM_UDID
IOS_SIM_AUTO_CREATE
EXPO_DEV_SERVER_PORT
MAESTRO_IOS_DEV_CLIENT_APP_PATH
MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID
MAESTRO_IOS_DEV_CLIENT_EXECUTABLE
MAESTRO_DEV_CLIENT_URL
EXPO_PID
SIMULATOR_SYSTEM_LOG_FILE
MAESTRO_ENV_LOCAL_PATH
MAESTRO_ENV_LOCAL_BACKUP
EOF
}

# Pre-authorize the dev-client URL schemes so the SpringBoard `Open in "<App>"?`
# trust dialog NEVER appears on a cold simulator. This is the deterministic fix
# for the iOS-26 + expo-dev-client first-launch trust prompt: rather than racing
# to tap "Open" after the dialog renders, we seed the same approval record iOS
# writes when a human taps "Open".
#
# The approval lives in the SpringBoard-scoped preference
# `com.apple.launchservices.schemeapproval`, keyed `<caller-bundle>-->scheme`
# with the value set to the target app's bundle id. `simctl openurl` always
# originates from `com.apple.CoreSimulator.CoreSimulatorBridge`, so that is the
# caller we authorize. Each scheme variant the harness opens needs its own entry:
#
#   * `exp+<scheme>`           — the dev-client `?url=` deep link (Metro handshake)
#   * `<scheme>`               — the `boga3://maestro-harness?...` teleport links
#   * `<bundle-id>`            — belt-and-braces for the app's own bundle scheme
#
# Verified on iPhone 17 Pro / iOS 26.2: after seeding these, opening BOTH
# `exp+boga3://...` and `boga3://...` surfaces zero trust dialogs and the RN root
# mounts directly. A failed write fails the launch: no flow taps the dialog
# away (an optional tap on an absent "Open" cost ~7s per deep link), so an
# unauthorized scheme would otherwise surface later as an unrelated assertion
# timeout behind the dialog.
maestro_preauthorize_url_schemes() {
  local udid="$1"
  local bundle_id="$2"
  local scheme="$3"
  local caller="com.apple.CoreSimulator.CoreSimulatorBridge"
  local approval_domain="com.apple.launchservices.schemeapproval"
  local dev_client_scheme
  local s

  [[ -n "$udid" ]] || maestro_fail "[maestro] preauthorize: missing simulator UDID"
  [[ -n "$bundle_id" ]] || maestro_fail "[maestro] preauthorize: missing bundle id"
  [[ -n "$scheme" ]] || maestro_fail "[maestro] preauthorize: missing app scheme"

  if [[ "$scheme" == exp+* ]]; then
    dev_client_scheme="$scheme"
    scheme="${scheme#exp+}"
  else
    dev_client_scheme="exp+$scheme"
  fi

  echo "[maestro] pre-authorizing URL schemes ($scheme, $dev_client_scheme, $bundle_id) for $bundle_id on $udid so the 'Open in \"<App>\"?' trust dialog never appears"

  for s in "$scheme" "$dev_client_scheme" "$bundle_id"; do
    if xcrun simctl spawn "$udid" defaults write "$approval_domain" "${caller}-->${s}" -string "$bundle_id" >/dev/null 2>&1; then
      echo "[maestro]   authorized scheme '$s' -> $bundle_id"
    else
      maestro_fail "[maestro] could not pre-authorize scheme '$s' on $udid: the 'Open in \"<App>\"?' dialog would block every deep link"
    fi
  done
}

# Pre-authorize location access for the dev-client bundle so the native
# "Allow <App> to use your location?" permission dialog NEVER renders on a cold
# simulator. The app requests location at session start, so on a freshly-created
# (or freshly-reinstalled) simulator with no prior TCC grant, iOS raises that
# system alert on top of the RN root. Maestro can render the screen underneath
# fine, but the alert steals focus and the render-visibility assertions time out.
#
# A `full` provision reset (uninstall + reinstall the dev client) clears any
# existing location grant, so without a pre-grant the dialog reappears on every
# cold run. We seed the grant with `simctl privacy ... grant`, the canonical way
# to authorize a permission ahead of first use, which is exactly the TCC record
# iOS would write if a human tapped "Allow". We grant both `location-always` and
# the in-use `location` scope as belt-and-braces so whichever the app requests is
# already authorized.
#
# Best-effort by design, mirroring the URL-scheme pre-auth: a missing udid or
# bundle id returns 0 (skips, never fails the gate). The grant is attempted
# directly — any failure (for example an older Xcode that lacks the `privacy`
# subcommand) is logged and tolerated rather than aborting the run, so a failed
# grant is itself the graceful fallback. Idempotent — re-granting an
# already-granted service is a no-op.
maestro_preauthorize_location() {
  local udid="$1"
  local bundle_id="$2"
  local service

  [[ -n "$udid" ]] || { echo "[maestro] preauthorize-location: missing simulator UDID (skipping)"; return 0; }
  [[ -n "$bundle_id" ]] || { echo "[maestro] preauthorize-location: missing bundle id (skipping)"; return 0; }

  echo "[maestro] pre-authorizing location (location-always) for $bundle_id on $udid so the cold-sim location dialog never appears"

  # Attempt the grant directly rather than probing for `simctl privacy` support
  # first — a failed grant IS the graceful fallback. On an Xcode without the
  # subcommand the grant simply fails and we log + tolerate it, exactly the same
  # path as any other grant error. This keeps the helper best-effort and never
  # lets it fail the gate.
  for service in location-always location; do
    if xcrun simctl privacy "$udid" grant "$service" "$bundle_id" >/dev/null 2>&1; then
      echo "[maestro]   granted '$service' -> $bundle_id"
    else
      echo "[maestro]   could not pre-authorize '$service' (best-effort; warm-up will backstop)"
    fi
  done
}

# Seed expo-dev-menu's preferences in the dev client's data container so its
# launch-time UI never covers the RN root. Since SDK 57 the dev menu opens its
# onboarding sheet ("Continue") on every fresh install; a `full` provision reset
# reinstalls the app, so it would come back every cold run. (Its floating "Dev
# tools" button is off in the binary's Info.plist, `app.config.ts`, so it also
# stays off after a flow's `clearState`.) The keys are expo-dev-menu's own
# (ios/Modules/DevMenuPreferences.swift), written into the app's preferences
# plist, where UserDefaults.standard reads them ahead of the registered defaults.
# The write goes through the simulator's own `defaults` so its cfprefsd records
# it; a host-side write to the plist is overwritten by cfprefsd's cached copy.
#
# Not best-effort: a miss leaves the sheet over every screen, so the flow's first
# assertion would fail far from the cause. Fail here instead.
maestro_seed_dev_menu_preferences() {
  local udid="$1"
  local bundle_id="$2"
  local container plist

  container="$(xcrun simctl get_app_container "$udid" "$bundle_id" data 2>/dev/null)" \
    || maestro_fail "Unable to resolve the $bundle_id data container on $udid to seed dev-menu preferences."
  plist="$container/Library/Preferences/$bundle_id.plist"
  xcrun simctl spawn "$udid" defaults write "$plist" EXDevMenuIsOnboardingFinished -bool true \
    && xcrun simctl spawn "$udid" defaults write "$plist" EXDevMenuShowsAtLaunch -bool false \
    || maestro_fail "Unable to seed dev-menu preferences in $plist."
  echo "[maestro] seeded dev-menu preferences (onboarding finished, no launch menu) for $bundle_id"
}

maestro_dev_client_bundle_id() {
  local app_path="$1"
  [[ -f "$app_path/Info.plist" ]] || maestro_fail "Missing Info.plist under dev client app path: $app_path"

  plutil -extract CFBundleIdentifier raw -o - "$app_path/Info.plist" 2>/dev/null \
    || maestro_fail "Unable to read CFBundleIdentifier from $app_path/Info.plist"
}

maestro_dev_client_executable_name() {
  local app_path="$1"
  [[ -f "$app_path/Info.plist" ]] || maestro_fail "Missing Info.plist under dev client app path: $app_path"

  plutil -extract CFBundleExecutable raw -o - "$app_path/Info.plist" 2>/dev/null \
    || maestro_fail "Unable to read CFBundleExecutable from $app_path/Info.plist"
}

maestro_simulator_name_for_udid() {
  local udid="$1"

  xcrun simctl list devices available -j | node -e '
    const fs = require("fs");
    const udid = process.argv[1];
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const runtimes = Object.values(data.devices ?? {});
    for (const devices of runtimes) {
      const match = devices.find((device) => device.udid === udid);
      if (match) {
        process.stdout.write(match.name);
        process.exit(0);
      }
    }
    process.exit(1);
  ' "$udid"
}

maestro_capture_simulator_logs() {
  local udid="$1"
  local executable_name="$2"
  local output_file="$3"
  local lookback="${4:-20m}"

  mkdir -p "$(dirname -- "$output_file")"

  if [[ -n "$executable_name" ]]; then
    if xcrun simctl spawn "$udid" log show \
      --style compact \
      --last "$lookback" \
      --predicate "process == \"$executable_name\"" >"$output_file" 2>&1; then
      return 0
    fi
  fi

  xcrun simctl spawn "$udid" log show --style compact --last "$lookback" >"$output_file" 2>&1
}

# Copy the dev client's crash reports from this run into the artifact root and
# name each crash on stdout. When the dev client crashes, the simulator falls
# back to the home screen. simulator-system.log is filtered to the app's own
# process, and SpringBoard is the process that logs the exit, so that log shows
# no crash. Without this step a crash reads as a flow that "lost" the app.
# A report belongs to this run when it is newer than the run's start marker, and
# to this slot when its procPath runs through this simulator's
# CoreSimulator/Devices/<UDID>/ (real reports escape the slashes as `\/`; the
# bare UDID is not enough, as reports also carry other UUIDs): every worktree's
# simulators write to the same host directory. This only reports: the flow's
# own assertions still decide pass or fail.
maestro_collect_crash_reports() {
  local udid="$1"
  local executable_name="$2"
  local since_marker="$3"
  local output_dir="$4"
  local reports_dir="${MAESTRO_CRASH_REPORTS_DIR:-$HOME/Library/Logs/DiagnosticReports}"
  local report

  [[ -n "$udid" && -n "$executable_name" && -f "$since_marker" && -d "$reports_dir" ]] || return 0

  while IFS= read -r report; do
    grep -qF -e "Devices/$udid/" -e "Devices\\/$udid\\/" -- "$report" || continue
    mkdir -p "$output_dir"
    cp "$report" "$output_dir/"
    echo "[maestro] dev client CRASHED during this run: $(maestro_crash_report_summary "$report")"
    echo "[maestro]   crash report: $output_dir/$(basename -- "$report")"
  done < <(find "$reports_dir" -maxdepth 1 -name "$executable_name-*.ips" -newer "$since_marker" 2>/dev/null | sort)
}

# One line per .ips report: the signal, the crashed thread and its top symbol.
maestro_crash_report_summary() {
  node -e '
    const fs = require("fs");
    const text = fs.readFileSync(process.argv[1], "utf8");
    const report = JSON.parse(text.slice(text.indexOf("\n") + 1));
    const exception = report.exception ?? {};
    const thread = report.threads?.[report.faultingThread] ?? {};
    const symbol = (thread.frames ?? []).find((frame) => frame.symbol)?.symbol ?? "an unsymbolicated frame";
    const signal = exception.signal ?? exception.type ?? "unknown signal";
    const threadName = thread.name ?? thread.queue ?? `#${report.faultingThread}`;
    console.log(`${signal} on thread ${threadName} in ${symbol.replace(/\(.*$/s, "")}`);
  ' "$1" 2>/dev/null || echo "unreadable report $(basename -- "$1")"
}
