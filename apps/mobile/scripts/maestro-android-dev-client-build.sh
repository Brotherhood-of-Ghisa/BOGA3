#!/usr/bin/env bash

# maestro-android-dev-client-build.sh — build or reuse the shared Android debug
# dev-client APK for the android-* Maestro lanes.
#
# Mirrors maestro-ios-dev-client-build.sh: the artifact is host-local and shared
# across every worktree (one canonical root,
# $HOME/.cache/boga/maestro/android-dev-client), and is rebuilt only when the
# .apk or its metadata is missing, or when --force is passed. Because the cache
# is not invalidated automatically, adding/removing/upgrading a NATIVE Android
# dependency or changing an Android-affecting native field in app.config.ts
# requires `--force` before the android lanes, exactly as on iOS.
#
# Contract: docs/specs/11-maestro-runtime-and-testing-conventions.md.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/maestro-android-runtime.sh"
maestro_source_env

BUILD_ROOT="$MAESTRO_ANDROID_SHARED_BUILD_ROOT"
APK_PATH="$MAESTRO_ANDROID_APK_PATH"
METADATA_FILE="$BUILD_ROOT/dev-client-build.env"
BUILD_LOG_FILE="$BUILD_ROOT/build.log"
# The build scratch lives under the shared root but is PID-scoped, so two
# worktrees that build the shared cache at the same time never clobber each
# other's workspace/derived output. Cleaned up on exit (including failure).
TEMP_ROOT="$BUILD_ROOT/tmp-build.$$"
WORKSPACE_DIR="$TEMP_ROOT/workspace"
STATUS="unknown"
REASON="unknown"
FORCE_REBUILD=0
PRINT_APK_PATH_ONLY=0
STATUS_ONLY=0

trap 'rm -rf "$TEMP_ROOT" 2>/dev/null || true' EXIT

usage() {
  cat <<'EOF'
Usage: ./scripts/maestro-android-dev-client-build.sh [options]

Reuse the shared Android debug dev-client APK for Maestro, building it only when
missing or when --force is passed.

Options:
  --force            Force a rebuild even when a cached artifact exists.
  --print-apk-path   Print the resolved .apk path after ensuring the artifact exists.
  --status           Print build status without building.
  -h, --help         Show this help text.
EOF
}

assert_expo_dev_client_dependency() {
  if node -e 'const pkg = require(process.argv[1]); process.exit(pkg.dependencies?.["expo-dev-client"] ? 0 : 1);' "$APP_DIR/package.json" >/dev/null 2>&1; then
    return 0
  fi

  maestro_fail "Missing expo-dev-client dependency in $APP_DIR/package.json. Run 'cd $APP_DIR && npx expo install expo-dev-client' first."
}

read_metadata_value() {
  local key="$1"

  if [[ ! -f "$METADATA_FILE" ]]; then
    return 0
  fi

  (
    # shellcheck disable=SC1090
    source "$METADATA_FILE"
    printf '%s' "${!key:-}"
  )
}

resolve_status() {
  if [[ ! -f "$APK_PATH" ]]; then
    STATUS="missing"
    REASON="artifact-missing"
    return 0
  fi

  STATUS="ready"
  REASON="artifact-cached"
}

print_status() {
  echo "status=$STATUS"
  echo "reason=$REASON"
  echo "build_root=$BUILD_ROOT"
  echo "apk_path=$APK_PATH"

  if [[ -f "$METADATA_FILE" ]]; then
    echo "built_at=$(read_metadata_value MAESTRO_ANDROID_BUILT_AT)"
    echo "package=$(read_metadata_value MAESTRO_ANDROID_PACKAGE)"
    echo "build_log=$BUILD_LOG_FILE"
  fi
}

# Mirror the iOS workspace prep: build from a copy of the app (minus generated
# native projects and the per-worktree config), with node_modules symlinked so
# the copy is cheap.
prepare_workspace() {
  rm -rf "$TEMP_ROOT"
  mkdir -p "$WORKSPACE_DIR" "$(dirname -- "$APK_PATH")"

  rsync -a \
    --exclude '.expo/' \
    --exclude 'artifacts/' \
    --exclude 'ios/' \
    --exclude 'android/' \
    --exclude 'node_modules/' \
    --exclude '.maestro/maestro.env.local' \
    "$APP_DIR/" "$WORKSPACE_DIR/"

  ln -s "$APP_DIR/node_modules" "$WORKSPACE_DIR/node_modules"
}

build_dev_client() {
  local built_apk_path
  local package_name
  local built_at
  local staged_apk

  maestro_require_command node "Install Node.js and run 'npm install' in $APP_DIR."
  maestro_require_command npm "Install Node.js and run 'npm install' in $APP_DIR."
  maestro_require_command npx "Install Node.js and run 'npm install' in $APP_DIR."
  maestro_require_command rsync "Install rsync."
  maestro_require_command java "Install a JDK (JAVA_HOME / PATH). Run './boga doctor --android'."
  maestro_android_require_sdk

  [[ -d "$APP_DIR/node_modules" ]] || maestro_fail "Missing $APP_DIR/node_modules. Run 'cd $APP_DIR && npm install' first."
  assert_expo_dev_client_dependency

  mkdir -p "$BUILD_ROOT"
  : >"$BUILD_LOG_FILE"

  prepare_workspace

  {
    echo "[maestro-android-dev-client-build] Shared build root: $BUILD_ROOT"
    echo "[maestro-android-dev-client-build] APK path: $APK_PATH"
    echo "[maestro-android-dev-client-build] Preparing native project via expo prebuild"
  } | tee -a "$BUILD_LOG_FILE"

  (
    cd "$WORKSPACE_DIR"
    CI=1 npx expo prebuild --platform android --clean --npm
  ) 2>&1 | tee -a "$BUILD_LOG_FILE"

  [[ -x "$WORKSPACE_DIR/android/gradlew" ]] \
    || maestro_fail "expo prebuild did not produce $WORKSPACE_DIR/android/gradlew."

  # Build ONLY the host's ABI (x86_64 on x86_64, arm64-v8a on Apple Silicon).
  # The cache is host-local and the host's own emulator runs the host ABI, so the
  # other ABIs are dead weight that roughly triple APK size and install time —
  # the same host-slice-only reasoning as the iOS build above.
  local rn_arch
  case "$(uname -m)" in
    x86_64|amd64) rn_arch="x86_64" ;;
    arm64|aarch64) rn_arch="arm64-v8a" ;;
    *) maestro_fail "Unsupported host architecture for the Android dev client: $(uname -m)" ;;
  esac

  {
    echo "[maestro-android-dev-client-build] Building debug APK with Gradle"
    echo "[maestro-android-dev-client-build] ANDROID_HOME: ${ANDROID_HOME:-}"
    echo "[maestro-android-dev-client-build] reactNativeArchitectures: $rn_arch (host-only; the shared cache is host-local)"
  } | tee -a "$BUILD_LOG_FILE"

  (
    cd "$WORKSPACE_DIR/android"
    ./gradlew :app:assembleDebug -x lint -x test -PreactNativeArchitectures="$rn_arch"
  ) 2>&1 | tee -a "$BUILD_LOG_FILE"

  built_apk_path="$WORKSPACE_DIR/android/app/build/outputs/apk/debug/app-debug.apk"
  if [[ ! -f "$built_apk_path" ]]; then
    built_apk_path="$(find "$WORKSPACE_DIR/android/app/build/outputs/apk" -name '*.apk' -type f | head -n 1)"
  fi
  [[ -f "$built_apk_path" ]] || maestro_fail "Gradle completed without producing a debug APK artifact."

  # Promote atomically: stage the freshly built APK into our PID-scoped temp dir
  # (same filesystem as the shared root), then rename it into place. A rename is
  # atomic within one volume, so a concurrent worktree reading the shared cache
  # observes either the previous complete .apk or the new one — never a partial
  # copy mid-write.
  staged_apk="$TEMP_ROOT/$(basename -- "$APK_PATH")"
  rm -f "$staged_apk"
  cp "$built_apk_path" "$staged_apk"
  rm -f "$APK_PATH"
  mv "$staged_apk" "$APK_PATH"

  package_name="$(maestro_current_android_package)"
  built_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  {
    printf 'MAESTRO_ANDROID_BUILT_AT=%q\n' "$built_at"
    printf 'MAESTRO_ANDROID_BUILD_METHOD=%q\n' "expo-prebuild+gradle-assembleDebug"
    printf 'MAESTRO_ANDROID_APK_PATH=%q\n' "$APK_PATH"
    printf 'MAESTRO_ANDROID_PACKAGE=%q\n' "$package_name"
    printf 'MAESTRO_ANDROID_SHARED_BUILD_ROOT=%q\n' "$BUILD_ROOT"
  } >"$METADATA_FILE"

  echo "[maestro-android-dev-client-build] Build complete: $APK_PATH" | tee -a "$BUILD_LOG_FILE"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE_REBUILD=1
      shift
      ;;
    --print-apk-path)
      PRINT_APK_PATH_ONLY=1
      shift
      ;;
    --status)
      STATUS_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      maestro_fail "Unknown option: $1"
      ;;
  esac
done

resolve_status

if [[ "$STATUS_ONLY" == "1" ]]; then
  print_status
  exit 0
fi

if [[ "$FORCE_REBUILD" == "1" ]]; then
  STATUS="missing"
  REASON="forced-rebuild"
fi

if [[ "$STATUS" != "ready" ]]; then
  build_dev_client
  resolve_status
fi

if [[ "$STATUS" != "ready" ]]; then
  maestro_fail "Shared dev-client build did not finish in a reusable state (status=$STATUS reason=$REASON)."
fi

if [[ "$PRINT_APK_PATH_ONLY" == "1" ]]; then
  echo "$APK_PATH"
  exit 0
fi

print_status
