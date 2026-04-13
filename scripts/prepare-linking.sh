#!/bin/bash

# Exit on error
set -e

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( dirname "$SCRIPT_DIR" )"

echo "=== Preparing Extensions Monorepo ==="
cd "$ROOT_DIR"

echo "Running pnpm install..."
pnpm install

echo "Building all packages..."
pnpm build

echo ""
echo "=== Preparation Complete! ==="
echo "All packages are built and ready to be linked."
