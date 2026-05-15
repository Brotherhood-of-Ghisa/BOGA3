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
