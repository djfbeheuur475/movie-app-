#!/bin/bash
# NextUp doctor: verify the full dev environment is healthy

set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'

PASS=0; FAIL=0; WARN=0

pass()    { printf "  ${GREEN}✓${NC} %s\n" "$1";                 PASS=$((PASS+1)); }
fail()    { printf "  ${RED}✗${NC} %s\n" "$1" >&2;              FAIL=$((FAIL+1)); }
warn()    { printf "  ${YELLOW}⚠${NC} %s\n" "$1";               WARN=$((WARN+1)); }
section() { echo ""; printf "${BOLD}%s${NC}\n" "$1"; }
detail()  { printf "    ${DIM}%s${NC}\n" "$1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

PACKAGE="com.harpershive.nextup"

echo ""
printf "${BOLD}NextUp Doctor — Environment Check${NC}\n"
echo "──────────────────────────────────"

# ── Node.js ───────────────────────────────────────────────────────────────────
section "Node.js"
if command -v node > /dev/null 2>&1; then
  NODE_VER=$(node --version)
  NODE_MAJOR=$(echo "$NODE_VER" | sed 's/v\([0-9]*\).*/\1/')
  if [ "$NODE_MAJOR" -ge 18 ]; then
    pass "node $NODE_VER"
  else
    fail "node $NODE_VER — Expo SDK 56 requires Node 18+. Install: brew install node"
  fi
else
  fail "node not found. Install from https://nodejs.org (v18 or later)"
fi

if command -v npm > /dev/null 2>&1; then
  pass "npm $(npm --version)"
else
  fail "npm not found"
fi

# ── Java ──────────────────────────────────────────────────────────────────────
section "Java (required for Gradle)"
if command -v java > /dev/null 2>&1; then
  JAVA_VER=$(java -version 2>&1 | head -1 | sed 's/.*version "\([^"]*\)".*/\1/')
  JAVA_MAJOR=$(echo "$JAVA_VER" | cut -d. -f1)
  if [ "$JAVA_MAJOR" -ge 17 ]; then
    pass "Java $JAVA_VER"
  else
    warn "Java $JAVA_VER — JDK 17+ recommended. Install: brew install openjdk@17"
  fi
else
  fail "Java not found. Install: brew install openjdk@17"
fi

# ── Android SDK ───────────────────────────────────────────────────────────────
section "Android SDK"

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

SDK=""
if SDK=$(find_sdk 2>/dev/null); then
  pass "SDK at $SDK"
else
  fail "Android SDK not found. Install Android Studio and open SDK Manager."
fi

ADB="${SDK:+$SDK/platform-tools/adb}"
EMU_BIN="${SDK:+$SDK/emulator/emulator}"

if [ -n "$ADB" ] && [ -x "$ADB" ]; then
  ADB_VER=$("$ADB" version 2>/dev/null | head -1 | sed 's/Android Debug Bridge version //')
  pass "adb $ADB_VER"
else
  fail "adb not found at ${SDK}/platform-tools/adb — install platform-tools via SDK Manager"
fi

if [ -n "$EMU_BIN" ] && [ -x "$EMU_BIN" ]; then
  pass "emulator binary found"
else
  fail "emulator not found at ${SDK}/emulator/emulator — install Emulator via SDK Manager"
fi

if [ -f "android/local.properties" ]; then
  LOCAL_SDK=$(grep '^sdk\.dir=' android/local.properties | cut -d= -f2-)
  pass "android/local.properties — sdk.dir=$LOCAL_SDK"
else
  warn "android/local.properties missing — will be generated on first build"
fi

# ── AVDs ─────────────────────────────────────────────────────────────────────
section "Android Virtual Devices"
if [ -n "$EMU_BIN" ] && [ -x "$EMU_BIN" ]; then
  AVDS=$("$EMU_BIN" -list-avds 2>/dev/null | grep -v '^$' || true)
  if [ -n "$AVDS" ]; then
    while IFS= read -r avd; do
      [ -z "$avd" ] && continue
      pass "AVD: $avd"
    done <<< "$AVDS"
  else
    fail "No AVDs found. Create one: Android Studio → Device Manager → Create Device."
  fi
else
  warn "Skipped — emulator binary not available"
fi

# ── Running devices ───────────────────────────────────────────────────────────
section "Connected Devices / Emulators"
FIRST_DEVICE=""
if [ -n "$ADB" ] && [ -x "$ADB" ]; then
  while IFS= read -r line; do
    SERIAL=$(echo "$line" | awk '{print $1}')
    STATE=$(echo  "$line" | awk '{print $2}')
    [ -z "$SERIAL" ] || [ -z "$STATE" ] && continue
    case "$STATE" in
      device)
        pass "$SERIAL  (ready)"
        [ -z "$FIRST_DEVICE" ] && FIRST_DEVICE="$SERIAL"
        ;;
      offline)     warn "$SERIAL  (offline — try unplugging and reconnecting)" ;;
      unauthorized) warn "$SERIAL  (unauthorized — accept USB debugging prompt on device)" ;;
    esac
  done < <("$ADB" devices 2>/dev/null | awk 'NR>1 && NF==2 {print}')

  if [ -z "$FIRST_DEVICE" ]; then
    warn "No devices ready. Start an emulator: npm run dev"
  fi
fi

# ── App installed ─────────────────────────────────────────────────────────────
section "App ($PACKAGE)"
if [ -n "$FIRST_DEVICE" ] && [ -n "$ADB" ] && [ -x "$ADB" ]; then
  if "$ADB" -s "$FIRST_DEVICE" shell pm list packages 2>/dev/null | grep -q "package:$PACKAGE"; then
    INSTALLED=1
  else
    INSTALLED=0
  fi
  if [ "$INSTALLED" != "0" ]; then
    pass "Installed on $FIRST_DEVICE"
    # Show version
    VER=$("$ADB" -s "$FIRST_DEVICE" shell dumpsys package "$PACKAGE" 2>/dev/null \
      | grep "versionName" | head -1 | tr -d ' ' | cut -d= -f2 || true)
    [ -n "$VER" ] && detail "versionName=$VER"
  else
    warn "Not installed on $FIRST_DEVICE — run: npm run dev"
  fi
else
  warn "Skipped — no device connected"
fi

# ── Metro ─────────────────────────────────────────────────────────────────────
section "Metro Bundler"
METRO_PID=$(lsof -iTCP:8081 -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
if [ -n "$METRO_PID" ]; then
  pass "Running on :8081  (pid $METRO_PID)"
else
  warn "Not running — starts automatically with: npm run dev"
fi

# ── Environment variables ─────────────────────────────────────────────────────
section "Environment Variables"

check_env() {
  local key="$1"
  local val="${!key:-}"
  # Fall back to reading directly from .env (no eval/export, so special chars are safe)
  if [ -z "$val" ] && [ -f "$ROOT/.env" ]; then
    val=$(grep "^${key}=" "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- || true)
  fi
  if [ -n "$val" ] && [ "$val" != "your-$(echo "$key" | tr '[:upper:]_' '[:lower:]-' | sed 's/expo-public-//')" ]; then
    pass "$key"
  else
    fail "$key not set — add it to .env"
  fi
}

check_env "EXPO_PUBLIC_SUPABASE_URL"
check_env "EXPO_PUBLIC_SUPABASE_ANON_KEY"
check_env "EXPO_PUBLIC_TMDB_API_KEY"
check_env "EXPO_PUBLIC_BACKEND_URL"
check_env "GEMINI_API_KEY"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────"
TOTAL=$((PASS + FAIL + WARN))
if [ $FAIL -eq 0 ]; then
  printf "${GREEN}${BOLD}All checks passed${NC}  ($PASS passed"
  [ $WARN -gt 0 ] && printf ", $WARN warnings"
  printf ")\n"
else
  printf "${RED}${BOLD}$FAIL check(s) failed${NC}  ($PASS passed, $FAIL failed, $WARN warnings)\n"
  echo ""
  printf "  Fix the issues above, then run: ${BOLD}npm run doctor${NC}\n"
fi
echo ""
