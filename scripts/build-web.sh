#!/usr/bin/env bash
# Build the web app into docs/app/ for GitHub Pages (which serves docs/ at
# https://djfbeheuur475.github.io/movie-app-/). Deploying = committing docs/ and pushing.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE="/movie-app-/app"
OUT="$(mktemp -d)/web"

EXPO_WEB_BASE_URL="$BASE" npx expo export --platform web --output-dir "$OUT" --clear

# public/index.html links root-relative files; point them at the sub-path.
sed -i '' -e "s#href=\"/manifest.json\"#href=\"$BASE/manifest.json\"#" \
          -e "s#href=\"/apple-touch-icon.png\"#href=\"$BASE/apple-touch-icon.png\"#" "$OUT/index.html"
sed -i '' -e "s#\"start_url\": \"/\"#\"start_url\": \"$BASE/\"#" -e "s#\"scope\": \"/\"#\"scope\": \"$BASE/\"#" "$OUT/manifest.json"

rm -rf docs/app
cp -R "$OUT" docs/app
# GitHub Pages has no SPA rewrites: unknown paths get the site's 404.html, so
# make that the app shell — deep links like /movie-app-/app/taste/rate then boot the app.
cp docs/app/index.html docs/404.html
# Pages runs Jekyll by default, which drops folders starting with "_" — i.e. _expo/, the app bundle.
touch docs/.nojekyll

echo "Built → docs/app ($(du -sh docs/app | cut -f1)). Deploy by committing docs/ and pushing."
