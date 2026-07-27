#!/bin/bash
# NextUp dev workflow: verify SDK → launch emulator → install if needed → start Metro

set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()  { printf "${BLUE}▸${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
fatal() { printf "\n${RED}✗ ERROR:${NC} %s\n\n" "$1" >&2; exit 1; }

PACKAGE="com.harpershive.nextup"
ACTIVITY=".MainActivity"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo ""
printf "${BOLD}NextUp — Android Dev${NC}\n"
echo "─────────────────────"

# ── 1. Android SDK ────────────────────────────────────────────────────────────
find_sdk() {
  for candidate in \
    "${ANDROID_HOME:-__unset__}" \
    "${ANDROID_SDK_ROOT:-__unset__}" \
    "$(grep '^sdk\.dir=' android/local.properties 2>/dev/null | cut -d= -f2- | tr -d '[:space:]')" \
    "$HOME/Library/Android/sdk" \
    "$HOME/Android/Sdk"; do
    [ "$candidate" = "__unset__" ] && continue
    [ -n "$candidate" ] && [ -d "$candidate" ] && echo "$candidate" && return 0
  done
  return 1
}

SDK=$(find_sdk) || fatal "Android SDK not found.\n  Set ANDROID_HOME, or run: npm run doctor"
ADB="$SDK/platform-tools/adb"
EMU="$SDK/emulator/emulator"
[ -x "$ADB" ] || fatal "adb not found at $ADB\n  Install platform-tools via Android Studio → SDK Manager."
[ -x "$EMU" ] || fatal "emulator not found at $EMU\n  Install emulator via Android Studio → SDK Manager."
ok "Android SDK  $SDK"

# ── 2. Emulator ───────────────────────────────────────────────────────────────
get_device() {
  "$ADB" devices 2>/dev/null \
    | awk 'NR>1 && $2=="device" {print $1; exit}'
}

DEVICE=$(get_device)

if [ -z "$DEVICE" ]; then
  AVD=$("$EMU" -list-avds 2>/dev/null | grep -v '^$' | head -1 || true)
  [ -z "$AVD" ] && fatal "No Android Virtual Devices found.\n  Create one: Android Studio → Device Manager → Create Device."

  info "Starting emulator: $AVD"
  "$EMU" -avd "$AVD" -no-snapshot-load -no-audio > /tmp/nextup-emu.log 2>&1 &

  info "Waiting for emulator to appear on adb..."
  ELAPSED=0
  while [ -z "$(get_device)" ]; do
    sleep 2; ELAPSED=$((ELAPSED + 2))
    [ $ELAPSED -ge 90 ] && fatal "Emulator did not appear after 90s.\n  Check /tmp/nextup-emu.log for errors."
  done
  DEVICE=$(get_device)

  info "Waiting for Android boot to complete..."
  "$ADB" -s "$DEVICE" wait-for-device 2>/dev/null
  ELAPSED=0
  until [ "$("$ADB" -s "$DEVICE" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')" = "1" ]; do
    sleep 2; ELAPSED=$((ELAPSED + 2))
    [ $ELAPSED -ge 120 ] && fatal "Boot timed out after 120s."
  done
  sleep 2  # let the launcher settle
fi
ok "Emulator ready  ($DEVICE)"

# ── 3. App install ────────────────────────────────────────────────────────────
if "$ADB" -s "$DEVICE" shell pm list packages 2>/dev/null | grep -q "package:$PACKAGE"; then
  INSTALLED=1
else
  INSTALLED=0
fi

if [ "$INSTALLED" = "0" ]; then
  warn "App not installed — building now (first run: 3–5 min, subsequent: ~60s)..."
  echo ""
  # expo run:android handles build + install + Metro start + app launch
  npx expo run:android --device "$DEVICE"
  exit 0
fi
ok "App installed"

# ── 4. Network health + adb reverse ──────────────────────────────────────────
# Check that the emulator can reach the host (10.0.2.2). If not, the QEMU
# virtual network stack hasn't initialized — reboot the emulator to fix it.
NETWORK_OK=$("$ADB" -s "$DEVICE" shell "ping -c 1 -W 1 10.0.2.2 > /dev/null 2>&1 && echo ok || echo fail" 2>/dev/null | tr -d '\r\n')
if [ "$NETWORK_OK" != "ok" ]; then
  warn "Emulator network not ready (10.0.2.2 unreachable) — rebooting emulator..."
  "$ADB" -s "$DEVICE" reboot
  info "Waiting for boot..."
  "$ADB" -s "$DEVICE" wait-for-device 2>/dev/null
  ELAPSED=0
  until [ "$("$ADB" -s "$DEVICE" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')" = "1" ]; do
    sleep 3; ELAPSED=$((ELAPSED + 3))
    [ $ELAPSED -ge 120 ] && fatal "Emulator reboot timed out."
  done
  sleep 3
  ok "Emulator rebooted, network ready"
fi
ok "Emulator network  (10.0.2.2 reachable)"

# adb reverse: both Metro (8081) and local backend (3001) must be forwarded.
"$ADB" -s "$DEVICE" reverse tcp:8081 tcp:8081 > /dev/null 2>&1 && ok "adb reverse 8081 (Metro)" || warn "adb reverse 8081 failed"
"$ADB" -s "$DEVICE" reverse tcp:3001 tcp:3001 > /dev/null 2>&1 && ok "adb reverse 3001 (backend)" || warn "adb reverse 3001 failed"

# ── 5. Metro + launch ─────────────────────────────────────────────────────────
METRO_PID=$(lsof -iTCP:8081 -sTCP:LISTEN -t 2>/dev/null | head -1 || true)

if [ -n "$METRO_PID" ]; then
  ok "Metro already running  (pid $METRO_PID)"
  info "Launching app..."
  "$ADB" -s "$DEVICE" shell am start -n "$PACKAGE/$ACTIVITY" > /dev/null 2>&1
  echo ""
  ok "App launched. Fast Refresh is active."
  printf "  Metro is running in another terminal. Ctrl+C has no effect here.\n"
  exit 0
fi

# Start Metro in foreground; launch app 6s later (gives Metro time to initialise)
(
  sleep 6
  "$ADB" -s "$DEVICE" shell am start -n "$PACKAGE/$ACTIVITY" > /dev/null 2>&1
  printf "\n${GREEN}✓${NC} App launched on emulator\n"
) &

echo ""
printf "${BOLD}Starting Metro — app will launch in ~6 seconds.${NC}\n"
printf "  r = reload  •  j = open JS debugger  •  Ctrl+C = stop Metro\n"
echo ""
npx expo start
