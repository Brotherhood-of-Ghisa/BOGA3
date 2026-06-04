#!/usr/bin/env bash

set -euo pipefail

IPA_PATH="${1:-}"

if [[ -z "$IPA_PATH" ]]; then
  echo "Usage: $0 path/to/build.ipa"
  exit 1
fi

if [[ ! -f "$IPA_PATH" ]]; then
  echo "Error: IPA not found: $IPA_PATH"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git is not installed or not in PATH"
  exit 1
fi

if ! command -v unzip >/dev/null 2>&1; then
  echo "Error: unzip is not installed or not in PATH"
  exit 1
fi

PLIST_BUDDY="/usr/libexec/PlistBuddy"

if [[ ! -x "$PLIST_BUDDY" ]]; then
  echo "Error: PlistBuddy not found at $PLIST_BUDDY"
  exit 1
fi

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "Error: not inside a git repository"
  exit 1
}

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean."
  echo
  git status --short
  echo
  echo "Commit or stash changes before tagging. Git tags commits, not vibes."
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/boga-ipa-check.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

unzip -q "$IPA_PATH" -d "$TMP_DIR"

APP_DIR="$(find "$TMP_DIR/Payload" -maxdepth 1 -type d -name "*.app" | head -n 1)"

if [[ -z "$APP_DIR" ]]; then
  echo "Error: Could not find .app directory inside IPA"
  exit 1
fi

APP_PLIST="$APP_DIR/Info.plist"

if [[ ! -f "$APP_PLIST" ]]; then
  echo "Error: Could not find app Info.plist inside IPA"
  echo "Expected: $APP_PLIST"
  exit 1
fi

read_plist_value() {
  local key="$1"
  local value

  if ! value="$("$PLIST_BUDDY" -c "Print :$key" "$APP_PLIST" 2>/dev/null)"; then
    echo "Error: Could not read $key from $APP_PLIST"
    exit 1
  fi

  echo "$value"
}

BUNDLE_ID="$(read_plist_value "CFBundleIdentifier")"
VERSION="$(read_plist_value "CFBundleShortVersionString")"
BUILD="$(read_plist_value "CFBundleVersion")"

TAG="preview-ios-v${VERSION}-b${BUILD}"
COMMIT="$(git rev-parse --short HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "IPA:          $IPA_PATH"
echo "Bundle ID:    $BUNDLE_ID"
echo "Version:      $VERSION"
echo "Build number: $BUILD"
echo "Git branch:   $BRANCH"
echo "Git commit:   $COMMIT"
echo "Tag:          $TAG"
echo

if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  echo "Error: tag already exists: $TAG"
  exit 1
fi

git tag -a "$TAG" -m "BoGa preview iOS TestFlight build v${VERSION} build ${BUILD}"

git push origin "$TAG"

echo
echo "Created and pushed tag: $TAG"