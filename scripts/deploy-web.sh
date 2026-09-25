#!/usr/bin/env bash
# Build the web app and deploy it to Cloudflare Pages → https://nextup-tv.pages.dev
# First time only: `npx wrangler login`. Cloudflare serves index.html for unknown
# paths (single-page app mode) as long as there's no 404.html, so deep links work.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="nextup-tv"
OUT="$(mktemp -d)/web"

npx expo export --platform web --output-dir "$OUT" --clear
rm -f "$OUT/404.html"

# Wrangler skips any directory named node_modules when uploading, which drops the
# icon fonts Expo bundles under assets/node_modules/. Move them and repoint the bundle.
if [ -d "$OUT/assets/node_modules" ]; then
  mv "$OUT/assets/node_modules" "$OUT/assets/vendor"
  grep -rl "/assets/node_modules/" "$OUT" --include='*.js' --include='*.html' --include='*.json' \
    | xargs sed -i '' 's#/assets/node_modules/#/assets/vendor/#g'
fi
if grep -rq "/assets/node_modules/" "$OUT" --include='*.js'; then
  echo "assets/node_modules references left in the bundle — aborting" >&2; exit 1
fi

# Wrangler 4.14x redirects `pages` commands to Workers (a *.workers.dev address).
# The project was created once with `pages project create --force` (classic Pages,
# the *.pages.dev address); commands against an existing Pages project aren't redirected.
npx -y wrangler pages deploy "$OUT" --project-name "$PROJECT" --branch main --commit-dirty=true

echo "Deployed → https://$PROJECT.pages.dev"
