#!/bin/bash
# NextUp rebuild: clean → npm install → full Gradle build → install on emulator

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()  { printf "${BLUE}▸${NC} %s\n" "$1"; }
ok()    { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn()  { printf "${YELLOW}⚠${NC} %s\n" "$1"; }
fatal() { printf "${RED}✗ ERROR:${NC} %s\n" "$1" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

echo ""
printf "${BOLD}NextUp Rebuild${NC}\n"
echo "───────────────"
warn "This will clean all build artifacts and reinstall from scratch (~5 min)."
echo ""

# ── 1. Clean ──────────────────────────────────────────────────────────────────
info "Step 1/3 — Clean"
bash "$SCRIPT_DIR/clean.sh"

# ── 2. npm install ────────────────────────────────────────────────────────────
echo ""
info "Step 2/3 — Installing packages..."
npm install
ok "npm install done"

# ── 3. Build + install + launch ───────────────────────────────────────────────
echo ""
info "Step 3/3 — Building and installing on emulator..."
printf "  expo run:android will start Metro and launch the app when done.\n\n"
npx expo run:android
