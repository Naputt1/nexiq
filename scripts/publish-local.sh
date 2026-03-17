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
pnpm --filter @nexu/shared build
pnpm --filter @nexu/extension-sdk build
pnpm --filter @nexu/analyser build
pnpm --filter nexu build
# pnpm --filter @nexu/tanstack-query-extension build
# pnpm --filter @nexu/tanstack-router-extension build

echo "Publishing packages..."

# Create/update .npmrc for local publishing
echo "//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}" > .npmrc
# No need for @nexu scope registry if it's on NPM

pnpm --filter @nexu/shared publish --no-git-checks --access public
pnpm --filter @nexu/extension-sdk publish --no-git-checks --access public
pnpm --filter @nexu/analyser publish --no-git-checks --access public
pnpm --filter nexu publish --no-git-checks --access public

# Cleanup
rm .npmrc

echo "All packages published successfully!"
