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
MAESTRO_ENV_LOCAL_PATH
MAESTRO_ENV_LOCAL_BACKUP
EOF
}

# Expo's dev server reads apps/mobile/.env.local authoritatively — in dev it wins
# over process.env and is what gets compiled into the served bundle — so the only
# reliable way to pin a lane's Supabase config is to materialize it into that
# file. This writes the lane's intended config from the EXPO_PUBLIC_SUPABASE_*
# vars the lane exported (real values for the auth lane; empty for every
# infra-free lane), after setting aside any pre-existing file so a developer's
# manual config is restored at teardown. The result: each lane's build is
# deterministic and immune to whatever .env.local a prior lane left on disk.
maestro_write_managed_env_local() {
  local app_dir="$1"
  local runtime_env_file="$2"
  local env_local="$app_dir/.env.local"

  MAESTRO_ENV_LOCAL_PATH="$env_local"
  MAESTRO_ENV_LOCAL_BACKUP=""
  if [[ -f "$env_local" ]]; then
    MAESTRO_ENV_LOCAL_BACKUP="${env_local}.maestro-backup.${MAESTRO_RUNNER_PID:-$$}"
    mv -f "$env_local" "$MAESTRO_ENV_LOCAL_BACKUP"
  fi

  {
    printf 'EXPO_PUBLIC_SUPABASE_URL=%s\n' "${EXPO_PUBLIC_SUPABASE_URL:-}"
    printf 'EXPO_PUBLIC_SUPABASE_ANON_KEY=%s\n' "${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}"
  } >"$env_local"

  # Metro's persistent transform cache keys a module's transform on its source +
  # babel config, NOT on the EXPO_PUBLIC_* values babel-preset-expo inlines — so a
  # previous lane's supabase.ts transform (with its baked-in URL) survives the
  # .env.local change above and would keep the prior backend. The launcher fixes
  # this by passing `--clear` to `expo start`, but clearing on every run forces a
  # needless cold bundle, so signal a clear ONLY when this lane's Supabase config
  # differs from what the cache was last built with (tracked per worktree).
  local signature_file="$app_dir/.maestro/.metro-supabase-signature"
  local signature
  # Hash both the URL and the anon key so a key rotation (not just a URL change)
  # also re-clears. The hash, not the raw values, is what lands on disk.
  signature="$(printf '%s\n%s' "${EXPO_PUBLIC_SUPABASE_URL:-infra-free}" "${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}" | /usr/bin/shasum | cut -d' ' -f1)"
  MAESTRO_METRO_CLEAR=0
  if [[ "$(cat "$signature_file" 2>/dev/null)" != "$signature" ]]; then
    MAESTRO_METRO_CLEAR=1
    mkdir -p "$(dirname "$signature_file")"
    printf '%s' "$signature" >"$signature_file"
  fi

  if [[ -n "${EXPO_PUBLIC_SUPABASE_URL:-}" ]]; then
    echo "[maestro] materialized lane .env.local: Supabase-configured (backup=${MAESTRO_ENV_LOCAL_BACKUP:-none}, metro_clear=${MAESTRO_METRO_CLEAR})"
  else
    echo "[maestro] materialized lane .env.local: infra-free, no Supabase (backup=${MAESTRO_ENV_LOCAL_BACKUP:-none}, metro_clear=${MAESTRO_METRO_CLEAR})"
  fi
}

# Restore the developer's apps/mobile/.env.local that maestro_write_managed_env_local
# set aside, removing the lane-managed file first. A no-op when no file was
# managed (the var is unset) so it is safe to call unconditionally at teardown.
maestro_restore_managed_env_local() {
  [[ -n "${MAESTRO_ENV_LOCAL_PATH:-}" ]] || return 0
  rm -f "$MAESTRO_ENV_LOCAL_PATH"
  if [[ -n "${MAESTRO_ENV_LOCAL_BACKUP:-}" && -f "${MAESTRO_ENV_LOCAL_BACKUP}" ]]; then
    mv -f "$MAESTRO_ENV_LOCAL_BACKUP" "$MAESTRO_ENV_LOCAL_PATH"
  fi
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

# Wait until Metro has built and SERVED the app-entry JS bundle — i.e. the bundle
# request triggered by the dev-client `openurl` has completed and the (possibly
# cold) bundle is now hot and cached. Metro logs a line like
#   iOS Bundled 3029ms node_modules/expo-router/entry.js (1704 modules)
# on completion; the first such entry-bundle line is the warm signal, after which
# the gated flow's RN root mounts in seconds.
#
# This replaces the former separate Maestro warm-up FLOW (maestro_warm_dev_client),
# which paid a full XCUITest driver install just to drive the same bundle build and,
# on the signed-out auth/sync lanes, then burned ~45s timing out on a data screen
# those lanes never reach. Polling Metro's own log returns the instant the bundle
# is ready, independent of which screen the lane lands on, with no extra driver.
maestro_wait_for_metro_bundle() {
  local log_file="$1"
  local timeout_seconds="$2"
  local started_at now

  started_at="$(date +%s)"
  while true; do
    if grep -qE 'iOS Bundled [0-9]+ms .*entry\.[jt]sx? ' "$log_file" 2>/dev/null; then
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
