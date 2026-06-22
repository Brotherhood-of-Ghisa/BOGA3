#!/usr/bin/env bash

# Prefer the caller's Java when it works. On macOS, /usr/bin/java can exist
# while no runtime is registered with java_home, so probe the command itself.
if ! java -version >/dev/null 2>&1; then
  for java_home in \
    "${JAVA_HOME:-}" \
    /opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home \
    /opt/homebrew/opt/openjdk \
    /usr/local/opt/openjdk/libexec/openjdk.jdk/Contents/Home \
    /usr/local/opt/openjdk; do
    [[ -n "${java_home}" ]] || continue
    [[ -x "${java_home}/bin/java" ]] || continue
    export JAVA_HOME="${java_home}"
    export PATH="${JAVA_HOME}/bin:${PATH}"
    break
  done
fi
