#!/usr/bin/env bash

# Resolve ANDROID_HOME and add platform-tools / emulator to PATH if available.
if [[ -z "${ANDROID_HOME:-}" ]]; then
  for candidate in \
    "${ANDROID_SDK_ROOT:-}" \
    "${HOME}/Library/Android/sdk" \
    "${HOME}/Android/Sdk" \
    /opt/android-sdk \
    /usr/lib/android-sdk; do
    if [[ -d "${candidate}" ]]; then
      export ANDROID_HOME="${candidate}"
      break
    fi
  done
fi

if [[ -n "${ANDROID_HOME:-}" && -d "${ANDROID_HOME}" ]]; then
  if [[ -d "${ANDROID_HOME}/platform-tools" && ":$PATH:" != *":${ANDROID_HOME}/platform-tools:"* ]]; then
    export PATH="${ANDROID_HOME}/platform-tools:${PATH}"
  fi
  if [[ -d "${ANDROID_HOME}/emulator" && ":$PATH:" != *":${ANDROID_HOME}/emulator:"* ]]; then
    export PATH="${ANDROID_HOME}/emulator:${PATH}"
  fi
fi
