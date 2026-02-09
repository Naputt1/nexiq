#!/bin/bash

# Get the absolute path of the project root
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT_DIR/packages/sample-project/git-demo"
DATA_DIR="$ROOT_DIR/scripts/git-demo-data"

echo "Setting up refactored Git Demo project in $DEMO_DIR..."

# Create directory if it doesn't exist
mkdir -p "$DEMO_DIR"
cd "$DEMO_DIR"

# Clean up existing files but keep the directory (prevents shell CWD issues)
rm -rf .git
rm -rf *

# Re-initialize Git
git init -b main

# Helper to apply a version
apply_version() {
    local version=$1
    echo "Applying $version..."
    # Copy all files from the version data directory
    cp -r "$DATA_DIR/$version/"* .
}

# v1: Initial structure
apply_version "v1"
git add .
git commit -m "Initial commit: monolithic App structure"

# v2: Add Sidebar file
apply_version "v2"
git add .
git commit -m "Add Sidebar component in separate file"

# v3: Refactor Header and Delete Footer
# Manually remove src/* to ensure we catch deletions between versions
rm -rf src/*
apply_version "v3"
git add .
git commit -m "Refactor Header to separate file and delete Footer"

# v4: Current modified state
rm -rf src/*
apply_version "v4"
git add .

echo ""
echo "Setup complete!"
echo "1. Monolithic App (Header, Content, Footer in one file)"
echo "2. Sidebar added as new file"
echo "3. Header moved to new file, Footer deleted"
echo "4. (Current) ThemeContext added, Content moved to file, App uses Provider (STAGED)"
echo ""
echo "Open '$DEMO_DIR' in react-map to see semantic Git changes."