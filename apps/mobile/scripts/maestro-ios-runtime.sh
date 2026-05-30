#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/maestro-env.sh"

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
MAESTRO_IOS_DEV_CLIENT_URL
EXPO_PID
SIMULATOR_SYSTEM_LOG_FILE
EOF
}

maestro_load_runtime_env() {
  local runtime_env_file="$1"
  [[ -f "$runtime_env_file" ]] || maestro_fail "Missing runtime env file: $runtime_env_file"

  set -a
  # shellcheck disable=SC1090
  source "$runtime_env_file"
  set +a
}

maestro_write_runtime_env() {
  local runtime_env_file="$1"
  local key

  mkdir -p "$(dirname -- "$runtime_env_file")"
  : >"$runtime_env_file"

  while IFS= read -r key; do
    if [[ -n "${!key+x}" ]]; then
      printf '%s=%q\n' "$key" "${!key}" >>"$runtime_env_file"
    fi
  done < <(maestro_runtime_keys)
}

maestro_runtime_artifact_root() {
  local timestamp="$1"
  printf '%s\n' "$APP_DIR/artifacts/maestro/$TASK_ID/$timestamp"
}

maestro_current_app_scheme() {
  (
    cd "$APP_DIR"
    npx expo config --json
  ) | node -e '
    const fs = require("fs");
    const config = JSON.parse(fs.readFileSync(0, "utf8"));
    const scheme = config?.scheme;
    if (Array.isArray(scheme)) {
      console.log(String(scheme[0] ?? ""));
      process.exit(0);
    }
    console.log(typeof scheme === "string" ? scheme : "");
  '
}

maestro_urlencode() {
  node -e 'process.stdout.write(encodeURIComponent(process.argv[1] ?? ""))' "$1"
}

maestro_development_client_url() {
  local port="$1"
  local scheme
  local dev_client_scheme
  local bundle_url

  scheme="$(maestro_current_app_scheme)"
  [[ -n "$scheme" ]] || maestro_fail "Unable to resolve Expo app scheme from $APP_DIR/app.json."
  if [[ "$scheme" == exp+* ]]; then
    dev_client_scheme="$scheme"
  else
    dev_client_scheme="exp+$scheme"
  fi

  bundle_url="http://127.0.0.1:$port"
  printf '%s://expo-development-client/?url=%s\n' "$dev_client_scheme" "$(maestro_urlencode "$bundle_url")"
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
# mounts directly. Best-effort: a write failure is logged and never fails the
# gate — the warm-up's coordinate/text dialog dismissal still backstops it.
maestro_preauthorize_url_schemes() {
  local udid="$1"
  local bundle_id="$2"
  local scheme="$3"
  local caller="com.apple.CoreSimulator.CoreSimulatorBridge"
  local approval_domain="com.apple.launchservices.schemeapproval"
  local dev_client_scheme
  local s

  [[ -n "$udid" ]] || { echo "[maestro] preauthorize: missing simulator UDID (skipping)"; return 0; }
  [[ -n "$bundle_id" ]] || { echo "[maestro] preauthorize: missing bundle id (skipping)"; return 0; }
  [[ -n "$scheme" ]] || { echo "[maestro] preauthorize: missing app scheme (skipping)"; return 0; }

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
      echo "[maestro]   could not pre-authorize scheme '$s' (best-effort; warm-up dialog dismissal will backstop)"
    fi
  done
}

maestro_wait_for_http() {
  local url="$1"
  local timeout_seconds="$2"
  local started_at now

  started_at="$(date +%s)"
  while true; do
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      return 0
    fi

    now="$(date +%s)"
    if (( now - started_at >= timeout_seconds )); then
      return 1
    fi

    sleep 1
  done
}

maestro_wait_for_metro_status() {
  local port="$1"
  local timeout_seconds="$2"
  local started_at now response

  started_at="$(date +%s)"
  while true; do
    response="$(curl --silent "http://127.0.0.1:$port/status" 2>/dev/null || true)"
    if [[ "$response" == *"packager-status:running"* ]]; then
      return 0
    fi

    now="$(date +%s)"
    if (( now - started_at >= timeout_seconds )); then
      return 1
    fi

    sleep 1
  done
}

maestro_process_alive() {
  local pid="${1:-}"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

maestro_wait_for_process_exit() {
  local pid="$1"
  local timeout_seconds="$2"
  local started_at now

  started_at="$(date +%s)"
  while maestro_process_alive "$pid"; do
    now="$(date +%s)"
    if (( now - started_at >= timeout_seconds )); then
      return 1
    fi
    sleep 1
  done
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

maestro_prepare_flow_copy() {
  local source_flow="$1"
  local target_flow="$2"
  local bundle_id="$3"

  [[ -f "$source_flow" ]] || maestro_fail "Missing Maestro flow file: $source_flow"
  mkdir -p "$(dirname -- "$target_flow")"

  node -e '
    const fs = require("fs");
    const [sourcePath, targetPath, bundleId] = process.argv.slice(1);
    const source = fs.readFileSync(sourcePath, "utf8").split(/\r?\n/);
    let replaced = false;
    const next = source.map((line) => {
      if (!replaced && /^appId:\s*/.test(line)) {
        replaced = true;
        return `appId: ${bundleId}`;
      }
      return line;
    });
    if (!replaced) {
      next.unshift(`appId: ${bundleId}`, "---");
    }
    fs.writeFileSync(targetPath, `${next.join("\n").replace(/\n?$/, "\n")}`);
  ' "$source_flow" "$target_flow" "$bundle_id"
}

# Cold simulators need a warm-up for two first-launch reasons:
#
#   1. URL-scheme trust: the first deep link of each scheme surfaces a SpringBoard
#      `Open in "<App>"?` alert on top of the RN root (iOS-26 + expo-dev-client).
#      This is now PRE-AUTHORIZED in maestro-ios-launch.sh via
#      `maestro_preauthorize_url_schemes` (it seeds the same
#      `com.apple.launchservices.schemeapproval` record iOS writes when a human
#      taps "Open"), so the dialog should never render. The dismissal steps below
#      remain only as defense-in-depth for any un-seeded scheme variant.
#   2. Cold Metro bundle: the very first `url=` load has to JS-bundle from
#      scratch (10s+), which alone can blow the real flow's 30s assertion window.
#      This is the warm-up's primary remaining job — drive the cold bundle hot.
#
# So the warm-up drives the SAME path the real flow takes: open the dev-client
# `url=` link AND the harness teleport, then wait for the RN root
# (`stats-history-screen`) to mount. After this, Metro's bundle is hot, so the
# gated flow asserts the root in seconds.
#
# Dialog dismissal (defense-in-depth, in case pre-authorization is bypassed):
#   * `tapOn: text: "Open"` — the alert IS in Maestro's accessibility tree on
#     iOS-26.2 (the "Open" button exposes `accessibilityText: "Open"`), so a text
#     tap dismisses it when present. Verified empirically.
#   * `tapOn: point: "68%,54%"` — a resolution-independent coordinate tap at the
#     "Open" button's location, as a backstop for the rare case the alert renders
#     just outside the queried hierarchy snapshot. Both taps are `optional` /
#     no-op when no alert is present (the expected case post-preauthorization).
maestro_warm_dev_client() {
  local udid="$1"
  local bundle_id="$2"
  local dev_client_url="$3"
  local warmup_flow="$4"
  local warmup_output_dir="$5"

  [[ -n "$udid" ]] || maestro_fail "maestro_warm_dev_client: missing simulator UDID."
  [[ -n "$bundle_id" ]] || maestro_fail "maestro_warm_dev_client: missing dev-client bundle id."
  [[ -n "$dev_client_url" ]] || maestro_fail "maestro_warm_dev_client: missing dev-client URL."

  mkdir -p "$(dirname -- "$warmup_flow")" "$warmup_output_dir"

  # The first openLink + teleport mirror the gated flow's own first two
  # `openLink`s so the cold JS bundle is fully loaded and the harness landing
  # screen is reached. `waitForAnimationToEnd` after each openLink lets any
  # (normally pre-authorized away) alert settle before the optional dismissal
  # taps. After each link we fire BOTH an optional text tap and an optional
  # coordinate tap on the "Open" button as defense-in-depth — both no-op when no
  # alert is present (the expected case once schemes are pre-authorized). The
  # final wait uses a bounded 45s timeout: enough to JS-bundle the cold root, but
  # short enough that a genuinely stuck state doesn't burn dead time before the
  # gated flow takes over.
  cat >"$warmup_flow" <<EOF
appId: ${bundle_id}
---
- openLink: "${dev_client_url}"
- waitForAnimationToEnd:
    timeout: 5000
- tapOn:
    text: "Open"
    optional: true
- tapOn:
    point: "68%,54%"
    optional: true
- openLink: "boga3://maestro-harness?teleport=session-list"
- waitForAnimationToEnd:
    timeout: 5000
- tapOn:
    text: "Open"
    optional: true
- tapOn:
    point: "68%,54%"
    optional: true
- extendedWaitUntil:
    visible:
      id: "stats-history-screen"
    timeout: 45000
EOF

  echo "[maestro] warming dev client on cold sim ($udid) — driving cold Metro bundle hot (URL-scheme trust pre-authorized in launch step; dialog dismissal kept as defense-in-depth)"

  # The warm-up is best-effort: it drives the cold JS bundle to hot, but the gated
  # flow is the authoritative assertion. A non-confirmation here is NOT a failure;
  # the gated flow still asserts the root authoritatively. So a non-zero warm-up
  # exit never short-circuits the gate, and we log it as informational (not an
  # error) to avoid a misleading false-negative in green runs.
  if maestro test "$warmup_flow" \
    --udid "$udid" \
    --test-output-dir "$warmup_output_dir" >/dev/null 2>&1; then
    echo "[maestro] dev-client warm-up complete — RN root mounted, Metro bundle hot (URL scheme pre-authorized; no trust dialog)"
  else
    echo "[maestro] dev-client warm-up best-effort done (RN root not confirmed within window; bundle warmed). Gated flow will assert authoritatively."
  fi
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
