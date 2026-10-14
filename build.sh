#!/bin/sh
# Hosting build (Cloudflare Pages runs `sh build.sh`, then publishes dist/): copies only the files the app needs, so
# notes and tooling (CLAUDE.md, serve.py, .claude/) aren't served. Add any new file the app loads to this list.
set -e
rm -rf dist
mkdir -p dist
cp -R index.html styles.css app.js sw.js manifest.webmanifest fonts icons dist/
