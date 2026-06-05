#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
source "$SCRIPT_DIR/maestro-env.sh"
maestro_source_env

BUILD_ROOT="$MAESTRO_IOS_SHARED_BUILD_ROOT"
APP_PATH="$MAESTRO_IOS_DEV_CLIENT_APP_PATH"
METADATA_FILE="$BUILD_ROOT/dev-client-build.env"
BUILD_LOG_FILE="$BUILD_ROOT/build.log"
# The build scratch lives under the shared root but is PID-scoped, so two
# worktrees that build the shared cache at the same time never clobber each
# other's workspace/derived-data. Cleaned up on exit (including failure).
TEMP_ROOT="$BUILD_ROOT/tmp-build.$$"
WORKSPACE_DIR="$TEMP_ROOT/workspace"
DERIVED_DATA_DIR="$TEMP_ROOT/derived-data"
STATUS="unknown"
REASON="unknown"
FORCE_REBUILD=0
PRINT_APP_PATH_ONLY=0
STATUS_ONLY=0

trap 'rm -rf "$TEMP_ROOT" 2>/dev/null || true' EXIT

usage() {
  cat <<'EOF'
Usage: ./scripts/maestro-ios-dev-client-build.sh [options]

Reuse the shared iOS simulator dev-client .app artifact for Maestro, building it
only when missing or when --force is passed.

Options:
  --force            Force a rebuild even when a cached artifact exists.
  --print-app-path   Print the resolved .app path after ensuring the artifact exists.
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
  if [[ ! -d "$APP_PATH" || ! -f "$APP_PATH/Info.plist" ]]; then
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
  echo "app_path=$APP_PATH"

  if [[ -f "$METADATA_FILE" ]]; then
    echo "built_at=$(read_metadata_value MAESTRO_IOS_DEV_CLIENT_BUILT_AT)"
    echo "bundle_id=$(read_metadata_value MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID)"
    echo "build_log=$BUILD_LOG_FILE"
  fi
}

# CocoaPods (Ruby) raises `Unicode Normalization not appropriate for ASCII-8BIT
# (Encoding::CompatibilityError)` during `pod install` when the shell locale is
# unset or non-UTF-8 (LC_ALL=C / POSIX) — common in bare CI/agent shells. Force a
# UTF-8 locale for the prebuild + pod install so file-name normalization runs
# under UTF-8. An already-UTF-8 locale is left untouched.
ensure_utf8_locale() {
  local current="${LC_ALL:-${LANG:-}}"

  case "$current" in
    *UTF-8*|*utf-8*|*UTF8*|*utf8*)
      return 0
      ;;
  esac

  export LANG="en_US.UTF-8"
  export LC_ALL="en_US.UTF-8"
  echo "[maestro-ios-dev-client-build] Forcing UTF-8 locale (was '${current:-unset}') for expo prebuild / pod install" | tee -a "$BUILD_LOG_FILE"
}

prepare_workspace() {
  rm -rf "$TEMP_ROOT"
  mkdir -p "$WORKSPACE_DIR" "$(dirname -- "$APP_PATH")"

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
  local workspace_path
  local scheme_name
  local host_arch
  local built_app_path
  local staged_app
  local bundle_id
  local built_at

  maestro_require_command node "Install Node.js and run 'npm install' in $APP_DIR."
  maestro_require_command npm "Install Node.js and run 'npm install' in $APP_DIR."
  maestro_require_command npx "Install Node.js and run 'npm install' in $APP_DIR."
  maestro_require_command shasum "Install the Xcode command line tools."
  maestro_require_command rsync "Install rsync."
  maestro_require_command ditto "Install macOS developer tools."
  maestro_require_command xcrun "Install Xcode and the iOS simulator runtime."
  maestro_require_command xcodebuild "Install Xcode and run 'xcode-select --switch /Applications/Xcode.app'."
  maestro_require_command pod "Install CocoaPods with 'brew install cocoapods'."

  [[ -d "$APP_DIR/node_modules" ]] || maestro_fail "Missing $APP_DIR/node_modules. Run 'cd $APP_DIR && npm install' first."
  assert_expo_dev_client_dependency

  mkdir -p "$BUILD_ROOT"
  : >"$BUILD_LOG_FILE"

  prepare_workspace
  ensure_utf8_locale

  {
    echo "[maestro-ios-dev-client-build] Shared build root: $BUILD_ROOT"
    echo "[maestro-ios-dev-client-build] App path: $APP_PATH"
    echo "[maestro-ios-dev-client-build] Preparing native project via expo prebuild"
  } | tee -a "$BUILD_LOG_FILE"

  (
    cd "$WORKSPACE_DIR"
    CI=1 npx expo prebuild --platform ios --clean --npm
  ) 2>&1 | tee -a "$BUILD_LOG_FILE"

  workspace_path="$(find "$WORKSPACE_DIR/ios" -maxdepth 1 -name '*.xcworkspace' | head -n 1)"
  [[ -n "$workspace_path" ]] || maestro_fail "Unable to find generated iOS workspace under $WORKSPACE_DIR/ios."
  scheme_name="$(basename -- "$workspace_path" .xcworkspace)"
  host_arch="$(uname -m)"

  {
    echo "[maestro-ios-dev-client-build] Building simulator app with xcodebuild"
    echo "[maestro-ios-dev-client-build] Workspace: $workspace_path"
    echo "[maestro-ios-dev-client-build] Scheme: $scheme_name"
    echo "[maestro-ios-dev-client-build] Simulator arch: $host_arch (host-only; the shared cache is host-local)"
  } | tee -a "$BUILD_LOG_FILE"

  # Build ONLY the host simulator slice (e.g. arm64 on Apple Silicon) rather than
  # the default fat arm64+x86_64. This cache is host-local and the host's own
  # simulators run the host architecture, so the second slice is dead weight that
  # roughly doubles compile time. ARCHS pins the slice deterministically.
  xcodebuild \
    -workspace "$workspace_path" \
    -scheme "$scheme_name" \
    -configuration Debug \
    -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$DERIVED_DATA_DIR" \
    ARCHS="$host_arch" \
    ONLY_ACTIVE_ARCH=YES \
    CODE_SIGNING_ALLOWED=NO \
    build 2>&1 | tee -a "$BUILD_LOG_FILE"

  built_app_path="$DERIVED_DATA_DIR/Build/Products/Debug-iphonesimulator/$scheme_name.app"
  if [[ ! -d "$built_app_path" ]]; then
    built_app_path="$(find "$DERIVED_DATA_DIR/Build/Products" -path '*/Debug-iphonesimulator/*.app' -type d | head -n 1)"
  fi
  [[ -d "$built_app_path" ]] || maestro_fail "xcodebuild completed without producing a simulator .app artifact."

  # Promote atomically: stage the freshly built .app into our PID-scoped temp dir
  # (same filesystem as the shared root), then rename it into place. A rename is
  # atomic within one volume, so a concurrent worktree reading the shared cache
  # observes either the previous complete .app or the new one — never a partial
  # copy mid-`ditto`.
  staged_app="$TEMP_ROOT/$(basename -- "$APP_PATH")"
  rm -rf "$staged_app"
  ditto "$built_app_path" "$staged_app"
  rm -rf "$APP_PATH"
  mv "$staged_app" "$APP_PATH"

  bundle_id="$(plutil -extract CFBundleIdentifier raw -o - "$APP_PATH/Info.plist" 2>/dev/null || true)"
  built_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  {
    printf 'MAESTRO_IOS_DEV_CLIENT_BUILT_AT=%q\n' "$built_at"
    printf 'MAESTRO_IOS_DEV_CLIENT_BUILD_METHOD=%q\n' "expo-prebuild+xcodebuild"
    printf 'MAESTRO_IOS_DEV_CLIENT_APP_PATH=%q\n' "$APP_PATH"
    printf 'MAESTRO_IOS_DEV_CLIENT_BUNDLE_ID=%q\n' "$bundle_id"
    printf 'MAESTRO_IOS_SHARED_BUILD_ROOT=%q\n' "$BUILD_ROOT"
  } >"$METADATA_FILE"

  echo "[maestro-ios-dev-client-build] Build complete: $APP_PATH" | tee -a "$BUILD_LOG_FILE"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE_REBUILD=1
      shift
      ;;
    --print-app-path)
      PRINT_APP_PATH_ONLY=1
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

if [[ "$PRINT_APP_PATH_ONLY" == "1" ]]; then
  echo "$APP_PATH"
  exit 0
fi

print_status
