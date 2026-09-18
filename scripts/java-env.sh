#!/usr/bin/env bash

# Prefer a JDK compatible with Gradle (Java 17 or 21).
# Note: Gradle 8.x fails on Java 25+ with "Unsupported class file major version".
find_compatible_java() {
  local candidates=()
  [[ -n "${JAVA_HOME:-}" ]] && candidates+=("${JAVA_HOME}")
  # Consider the active PATH java as a candidate
  if command -v java >/dev/null 2>&1; then
    local path_java
    path_java="$(command -v java)"
    if [[ -L "${path_java}" ]]; then
      path_java="$(readlink -f "${path_java}" 2>/dev/null || realpath "${path_java}" 2>/dev/null || echo "${path_java}")"
    fi
    local path_home
    path_home="$(dirname "$(dirname "${path_java}")")"
    [[ -d "${path_home}" ]] && candidates+=("${path_home}")
  fi

  candidates+=(
    /usr/lib/jvm/java-17-openjdk
    /usr/lib/jvm/java-21-openjdk
    /usr/lib/jvm/default
    /usr/lib/jvm/default-runtime
    /opt/homebrew/opt/openjdk@17
    /opt/homebrew/opt/openjdk@21
    /opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home
    /opt/homebrew/opt/openjdk
    /usr/local/opt/openjdk
    /opt/android-studio/jbr
  )

  # Look strictly for Java 17 or 21 (Gradle 8.x compatible)
  local java_home ver
  for java_home in "${candidates[@]}"; do
    [[ -x "${java_home}/bin/java" ]] || continue
    ver="$("${java_home}/bin/java" -version 2>&1 | head -n 1 | awk -F '"' '{print $2}' | cut -d'.' -f1)"
    if [[ "$ver" == "17" || "$ver" == "21" ]]; then
      export JAVA_HOME="${java_home}"
      export PATH="${JAVA_HOME}/bin:${PATH}"
      return 0
    fi
  done

  # If no compatible JDK was found and JAVA_HOME is set to an incompatible version,
  # clear JAVA_HOME so Gradle does not consume an unsupported runtime.
  if [[ -n "${JAVA_HOME:-}" ]]; then
    local jh_ver
    jh_ver="$("${JAVA_HOME}/bin/java" -version 2>&1 | head -n 1 | awk -F '"' '{print $2}' | cut -d'.' -f1 2>/dev/null || true)"
    if [[ "$jh_ver" != "17" && "$jh_ver" != "21" ]]; then
      unset JAVA_HOME
    fi
  fi

  return 1
}

find_compatible_java || true


