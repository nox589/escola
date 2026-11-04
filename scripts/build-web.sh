#!/usr/bin/env bash
# Builds the web version of the app for a static host (Render static site).
# pnpm is preinstalled on Render, so no corepack step (its /usr is read-only).
set -euo pipefail
pnpm install --frozen-lockfile --filter @escola/mobile...
cd apps/mobile
npx expo export --platform web --output-dir dist
# Deep links (e.g. /item/123) fall back to the app shell.
cp dist/index.html dist/404.html
