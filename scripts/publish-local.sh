#!/bin/bash
set -e

# This script helps publish packages to npm locally using changesets.
# It requires NODE_AUTH_TOKEN to be set in your environment.
# Note: versions should already be bumped via `pnpm version-packages`.

if [ -z "$NODE_AUTH_TOKEN" ]; then
  echo "Error: NODE_AUTH_TOKEN is not set."
  echo "Please set it: export NODE_AUTH_TOKEN=your_npm_token"
  exit 1
fi

echo "Building all packages..."
pnpm --filter @nexiq/shared build
pnpm --filter @nexiq/extension-sdk build
pnpm --filter @nexiq/analyser build
pnpm --filter @nexiq/server build
pnpm --filter @nexiq/cli build

echo "Publishing packages via changesets..."

# Create/update .npmrc for local publishing
echo "//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}" > .npmrc

pnpm release

# Cleanup
rm .npmrc

echo "All packages published successfully!"
