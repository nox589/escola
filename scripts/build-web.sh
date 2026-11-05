#!/usr/bin/env bash
# Builds the web version of the app for a static host (Render static site).
# pnpm is preinstalled on Render, so no corepack step (its /usr is read-only).
set -euo pipefail
pnpm install --frozen-lockfile --filter @escola/mobile...
cd apps/mobile
npx expo export --platform web --output-dir dist
# Installable web app: manifest, Home Screen icons, service worker (push notifications).
cp web/* dist/
# In-app PDF viewer (pdf.js), served from our own origin.
mkdir -p dist/pdfjs && cp node_modules/pdfjs-dist/build/pdf.min.js node_modules/pdfjs-dist/build/pdf.worker.min.js dist/pdfjs/
node -e '
const fs = require("fs");
const p = "dist/index.html";
let s = fs.readFileSync(p, "utf8");
const tags = [
  "<link rel=\"manifest\" href=\"/manifest.webmanifest\">",
  "<link rel=\"apple-touch-icon\" href=\"/apple-touch-icon.png\">",
  "<meta name=\"apple-mobile-web-app-capable\" content=\"yes\">",
  "<meta name=\"mobile-web-app-capable\" content=\"yes\">",
  "<meta name=\"apple-mobile-web-app-title\" content=\"MiCole\">",
  "<meta name=\"apple-mobile-web-app-status-bar-style\" content=\"default\">",
  "<meta name=\"theme-color\" content=\"#FAF7F0\">",
].join("");
if (!s.includes("rel=\"manifest\"")) s = s.replace("</head>", tags + "</head>");
fs.writeFileSync(p, s);
'
# Deep links (e.g. /item/123) fall back to the app shell.
cp dist/index.html dist/404.html
