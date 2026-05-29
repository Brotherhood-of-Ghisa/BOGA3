#!/usr/bin/env bash
set -euo pipefail

IOS_SIM_DEVICE="${IOS_SIM_DEVICE:-iPhone 17 Pro}"
IOS_SIM_UDID="${IOS_SIM_UDID:-}"
IOS_SIM_AUTO_CREATE="${IOS_SIM_AUTO_CREATE:-0}"
MODE="${1:-boot}"

find_udid() {
  xcrun simctl list devices available \
    | sed -n "s/^[[:space:]]*${IOS_SIM_DEVICE//\//\\/} (\\([^)]*\\)).*/\\1/p" \
    | head -n 1
}

preferred_runtime() {
  xcrun simctl list runtimes -j | node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const runtimes = (data.runtimes ?? [])
      .filter((runtime) => runtime.isAvailable && /^iOS/.test(runtime.name ?? ""));
    runtimes.sort((a, b) => {
      const av = String(a.version ?? "").split(".").map(Number);
      const bv = String(b.version ?? "").split(".").map(Number);
      for (let i = 0; i < Math.max(av.length, bv.length); i += 1) {
        const delta = (bv[i] ?? 0) - (av[i] ?? 0);
        if (delta !== 0) return delta;
      }
      return String(b.name ?? "").localeCompare(String(a.name ?? ""));
    });
    if (!runtimes[0]?.identifier) process.exit(1);
    process.stdout.write(runtimes[0].identifier);
  '
}

preferred_device_type() {
  xcrun simctl list devicetypes -j | node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const devices = data.devicetypes ?? [];
    const preferredNames = ["iPhone 17 Pro", "iPhone 16 Pro", "iPhone 15 Pro"];
    for (const name of preferredNames) {
      const match = devices.find((device) => device.name === name && device.identifier);
      if (match) {
        process.stdout.write(match.identifier);
        process.exit(0);
      }
    }
    const fallback = devices.find((device) => /^iPhone/.test(device.name ?? "") && device.identifier);
    if (!fallback) process.exit(1);
    process.stdout.write(fallback.identifier);
  '
}

create_simulator() {
  local runtime_id device_type_id

  runtime_id="$(preferred_runtime)" || {
    echo "Unable to resolve an available iOS simulator runtime." >&2
    return 1
  }
  device_type_id="$(preferred_device_type)" || {
    echo "Unable to resolve an available iPhone simulator device type." >&2
    return 1
  }

  echo "[maestro] sim \"${IOS_SIM_DEVICE}\" not found — creating (deviceType=${device_type_id}, runtime=${runtime_id})" >&2
  xcrun simctl create "$IOS_SIM_DEVICE" "$device_type_id" "$runtime_id"
}

SIM_UDID="$IOS_SIM_UDID"

if [[ -z "$SIM_UDID" ]]; then
  SIM_UDID="$(find_udid)"
fi

if [[ -z "$SIM_UDID" && "$IOS_SIM_AUTO_CREATE" == "1" ]]; then
  SIM_UDID="$(create_simulator)"
fi

if [[ -z "$SIM_UDID" ]]; then
  echo "Unable to find iOS simulator device '${IOS_SIM_DEVICE}'." >&2
  echo "Set IOS_SIM_AUTO_CREATE=1 to create a dedicated simulator automatically." >&2
  echo "Available devices:" >&2
  xcrun simctl list devices available >&2
  exit 1
fi

if [[ "$MODE" == "--udid-only" ]]; then
  echo "$SIM_UDID"
  exit 0
fi

xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1 || true

BOOT_READY=false
for _ in 1 2 3 4 5 6; do
  if xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null 2>&1; then
    BOOT_READY=true
    break
  fi
  sleep 2
done

if [[ "$BOOT_READY" != true ]]; then
  echo "Simulator '$IOS_SIM_DEVICE' ($SIM_UDID) did not report boot-ready status." >&2
  xcrun simctl list devices | sed -n '1,120p' >&2
  exit 1
fi

echo "$SIM_UDID"
