#!/usr/bin/env bash

# maestro-runtime.sh — platform-neutral Maestro runtime helpers, shared by the
# iOS and Android toolkits. Sourced, never run.
#
# Everything here is platform-agnostic: artifact paths, runtime-state
# persistence, Metro probing, process waits, flow-copy rewriting, the managed
# .env.local pinning and the dev-client URL. Platform-specific helpers (simulator
# / emulator control, device log capture, native permission and scheme
# authorization) live in maestro-ios-runtime.sh / maestro-android-runtime.sh,
# which both source this file and each define their own `maestro_runtime_keys`
# (the runtime.env key set `maestro_write_runtime_env` persists).
#
# Contract: docs/specs/11-maestro-runtime-and-testing-conventions.md.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/maestro-env.sh"

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

# The expo-dev-client deep link that hands the running dev client the Metro
# bundle URL. The `exp+<scheme>://expo-development-client/?url=…` shape is the
# same on iOS and Android, so both launchers share it.
maestro_development_client_url() {
  local port="$1"
  local scheme
  local dev_client_scheme
  local bundle_url

  scheme="$(maestro_current_app_scheme)"
  [[ -n "$scheme" ]] || maestro_fail "Unable to resolve Expo app scheme from $APP_DIR/app.config.ts."
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

# Wait until Metro has built and SERVED the app-entry JS bundle — i.e. the bundle
# request triggered by the dev-client launch has completed and the (possibly
# cold) bundle is now hot and cached. Metro logs a line like
#   iOS Bundled 3029ms node_modules/expo-router/entry.js (1704 modules)
#   Android Bundled 3029ms node_modules/expo-router/entry.js (1704 modules)
# on completion; the first such entry-bundle line is the warm signal, after which
# the gated flow's RN root mounts in seconds.
#
# This replaces a separate Maestro warm-up FLOW, which paid a full driver install
# just to drive the same bundle build and, on the signed-out auth/sync lanes, then
# burned ~45s timing out on a data screen those lanes never reach. Polling Metro's
# own log returns the instant the bundle is ready, independent of which screen the
# lane lands on, with no extra driver.
maestro_wait_for_metro_bundle() {
  local log_file="$1"
  local timeout_seconds="$2"
  local started_at now

  started_at="$(date +%s)"
  while true; do
    if grep -qE '(iOS|Android) Bundled [0-9]+ms .*entry\.[jt]sx? ' "$log_file" 2>/dev/null; then
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

# Expo's dev server reads apps/mobile/.env.local authoritatively — in dev it wins
# over process.env and is what gets compiled into the served bundle — so the only
# reliable way to pin a lane's Supabase config is to materialize it into that
# file. This writes the lane's intended config from the EXPO_PUBLIC_SUPABASE_*
# vars the lane exported (real values for the Supabase lanes; empty for every
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
  local signature hasher
  # Hash both the URL and the anon key so a key rotation (not just a URL change)
  # also re-clears. The hash, not the raw values, is what lands on disk.
  if command -v shasum >/dev/null 2>&1; then
    hasher="shasum"
  else
    hasher="sha1sum"
  fi
  signature="$(printf '%s\n%s' "${EXPO_PUBLIC_SUPABASE_URL:-infra-free}" "${EXPO_PUBLIC_SUPABASE_ANON_KEY:-}" | "$hasher" | cut -d' ' -f1)"
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
