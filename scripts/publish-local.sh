#!/bin/bash
set -e

# This script helps publish packages to GitHub Packages locally.
# It requires NODE_AUTH_TOKEN to be set in your environment.

if [ -z "$NODE_AUTH_TOKEN" ]; then
  echo "Error: NODE_AUTH_TOKEN is not set."
  echo "Please set it: export NODE_AUTH_TOKEN=your_github_token"
  exit 1
fi

echo "Building all packages..."
pnpm --filter @react-map/shared build
pnpm --filter @react-map/extension-sdk build
pnpm --filter @react-map/tanstack-query-extension build
pnpm --filter @react-map/tanstack-router-extension build

echo "Publishing packages..."

# Create/update .npmrc for local publishing
echo "//npm.pkg.github.com/:_authToken=\${NODE_AUTH_TOKEN}" > .npmrc
echo "@react-map:registry=https://npm.pkg.github.com" >> .npmrc

pnpm --filter @react-map/shared publish --no-git-checks
pnpm --filter @react-map/extension-sdk publish --no-git-checks
pnpm --filter @react-map/tanstack-query-extension publish --no-git-checks
pnpm --filter @react-map/tanstack-router-extension publish --no-git-checks

# Cleanup
rm .npmrc

echo "All packages published successfully!"
