#!/usr/bin/env bash
# Local full stack for demos/dev: mock GestIB portal, API, worker, web build.
# Requires Postgres (with pgvector) and Redis running, and a filled-in .env (see .env.example).
#   scripts/stack.sh up [logdir]   |   scripts/stack.sh down
set -euo pipefail
cd "$(dirname "$0")/.."
LOGS="${2:-.data/logs}"
PIDS=.data/pids

case "${1:-up}" in
  up)
    mkdir -p "$LOGS" "$PIDS"
    pnpm build >/dev/null
    pnpm db:migrate
    (cd apps/mock-portal && exec node ../../node_modules/tsx/dist/cli.mjs src/server.ts) >"$LOGS/mock.log" 2>&1 & echo $! >"$PIDS/mock"
    (cd apps/api && exec node ../../node_modules/tsx/dist/cli.mjs --env-file=../../.env src/server.ts) >"$LOGS/api.log" 2>&1 & echo $! >"$PIDS/api"
    (cd workers/sync && exec node ../../node_modules/tsx/dist/cli.mjs --env-file=../../.env src/main.ts) >"$LOGS/worker.log" 2>&1 & echo $! >"$PIDS/worker"
    (cd apps/mobile && [ -d dist ] || npx expo export --platform web --output-dir dist >/dev/null)
    node scripts/serve-web.mjs 8081 >"$LOGS/web.log" 2>&1 & echo $! >"$PIDS/web"
    sleep 6
    curl -sf localhost:3000/health >/dev/null && echo "API     http://localhost:3000"
    echo "Web app http://localhost:8081   (mock GestIB login: parent1 / escola123)"
    echo "Magic links are printed in $LOGS/api.log"
    ;;
  down)
    for f in "$PIDS"/*; do [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; done
    ;;
esac
