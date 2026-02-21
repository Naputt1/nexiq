#!/bin/bash

# Exit on error
set -e

BENCHMARK_DIR="benchmarks/projects"
mkdir -p "$BENCHMARK_DIR"

# Project URLs
SMALL_REPO="https://github.com/alan2207/bulletproof-react"
MID_REPO="https://github.com/gothinkster/react-redux-realworld-example-app"
LARGE_REPO="https://github.com/mattermost/mattermost-webapp"

echo "### Setting up Benchmark Projects ###"

# Function to clone and configure
setup_project() {
    local name=$1
    local repo=$2
    local target="$BENCHMARK_DIR/$name"

    if [ ! -d "$target" ]; then
        echo "Cloning $name..."
        git clone --depth 1 "$repo" "$target"
    else
        echo "$name already exists, skipping clone."
    fi

    echo "Configuring $name..."
    cat <<EOF > "$target/react.map.config.json"
{
  "ignorePatterns": [
    "node_modules",
    ".git",
    "dist",
    "build",
    "tests",
    "coverage",
    "__tests__",
    "mocks",
    "*.test.ts",
    "*.test.tsx",
    "*.spec.ts",
    "*.spec.tsx"
  ],
  "extensions": [
    "@react-map/tanstack-router-extension",
    "@react-map/tanstack-query-extension"
  ]
}
EOF
}

setup_project "small" "$SMALL_REPO"
setup_project "mid" "$MID_REPO"
setup_project "large" "$LARGE_REPO"

echo "### Setup Complete ###"
echo "Projects are located in $BENCHMARK_DIR"
