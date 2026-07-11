#!/bin/bash
# NextUp clean: stop Metro, clear Gradle build output, clear Metro/Expo caches

set -uo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()  { printf "${BLUE}▸${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
fatal() { printf "${RED}✗ ERROR:${NC} %s\n" "$1" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo ""
printf "${BOLD}NextUp Clean${NC}\n"
echo "─────────────"

# ── Metro ─────────────────────────────────────────────────────────────────────
METRO_PID=$(lsof -iTCP:8081 -sTCP:LISTEN -t 2>/dev/null | head -1 || true)
if [ -n "$METRO_PID" ]; then
  info "Stopping Metro (pid $METRO_PID)..."
  kill "$METRO_PID" 2>/dev/null || true
  ok "Metro stopped"
else
  ok "Metro not running"
fi

# ── Gradle build output ───────────────────────────────────────────────────────
if [ -d "android" ]; then
  info "Running Gradle clean..."
  cd android
  ./gradlew clean --quiet 2>&1 | tail -5
  cd "$ROOT"
  ok "Gradle clean done"
fi

# ── Metro / Haste cache ───────────────────────────────────────────────────────
info "Clearing Metro cache..."
rm -rf /tmp/metro-bundler-cache-* /tmp/haste-map-* /tmp/metro-* 2>/dev/null || true
rm -rf "$ROOT/node_modules/.cache" 2>/dev/null || true
ok "Metro cache cleared"

# ── Expo cache ────────────────────────────────────────────────────────────────
info "Clearing Expo cache..."
rm -rf "$ROOT/.expo" 2>/dev/null || true
ok "Expo cache cleared"

echo ""
ok "Clean complete."
printf "  Next steps:  npm run dev  (reuse existing build)\n"
printf "               npm run rebuild  (full clean rebuild)\n\n"
