#!/usr/bin/env bash

# Prefer a JDK compatible with Gradle (Java 17 or 21).
# Note: Gradle 8.x fails on Java 25+ with "Unsupported class file major version".
find_compatible_java() {
  local candidates=()
  [[ -n "${JAVA_HOME:-}" ]] && candidates+=("${JAVA_HOME}")
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

  # First pass: look for Java 17 or 21 (Gradle 8.x compatible)
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

  # Second pass: fallback to any available java_home
  for java_home in "${candidates[@]}"; do
    [[ -x "${java_home}/bin/java" ]] || continue
    export JAVA_HOME="${java_home}"
    export PATH="${JAVA_HOME}/bin:${PATH}"
    return 0
  done
  return 1
}

find_compatible_java || true


