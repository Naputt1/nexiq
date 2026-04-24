#!/bin/bash

# Exit on error
set -e

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
ROOT_DIR="$( dirname "$SCRIPT_DIR" )"

echo "=== Preparing Nexiq Monorepo for Linking ==="
cd "$ROOT_DIR"

echo "Running pnpm install..."
pnpm install

echo "Building core packages..."
pnpm --filter "@nexiq/shared" build
pnpm --filter "@nexiq/extension-sdk" build
pnpm --filter "@nexiq/analyser" build
pnpm --filter "@nexiq/server" build
pnpm --filter "@nexiq/cli" build

echo "Linking CLI globally..."
cd "$ROOT_DIR/packages/cli"
pnpm link --global

echo "Preparing other packages for linking..."
# These packages will be available for linking by the UI repository
packages=("shared" "extension-sdk" "analyser" "server")

for pkg in "${packages[@]}"; do
  echo "Linking $pkg..."
  cd "$ROOT_DIR/packages/$pkg"
  pnpm link
done

echo ""
echo "=== Preparation Complete! ==="
echo "Core packages are built."
echo "The 'nexiq' command should now be available globally."
echo "Other packages (@nexiq/shared, @nexiq/extension-sdk, etc.) are ready to be linked in the UI repository."
