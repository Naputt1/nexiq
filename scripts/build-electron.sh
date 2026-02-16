#!/bin/bash
set -e

# Ensure we are in the root directory
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "Cleaning up output directory..."
rm -rf "$ROOT_DIR/out/ui"
mkdir -p "$ROOT_DIR/out"

echo "Building all packages..."
# Build shared and analyser first
pnpm --filter shared build
pnpm --filter analyser build

echo "Building UI renderer and main..."
pnpm --filter ui build:vite

echo "Deploying production dependencies to out/ui..."
# --legacy avoids pnpm symlinks which Electron doesn't like
pnpm --filter=ui deploy --legacy "$ROOT_DIR/out/ui"

echo "Copying build artifacts and config..."
cp -r "$ROOT_DIR/packages/ui/dist" "$ROOT_DIR/out/ui/"
cp -r "$ROOT_DIR/packages/ui/dist-electron" "$ROOT_DIR/out/ui/"
cp "$ROOT_DIR/packages/ui/electron-builder.json5" "$ROOT_DIR/out/ui/"
cp "$ROOT_DIR/packages/ui/package.json" "$ROOT_DIR/out/ui/package.json"

echo "Running electron-builder..."
cd "$ROOT_DIR/out/ui"

# Use the electron-builder binary. 
# On Windows/Git Bash, the extension-less file in .bin is a shell script that works.
"$ROOT_DIR/node_modules/.bin/electron-builder" "$@"
