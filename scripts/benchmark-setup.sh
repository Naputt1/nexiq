#!/bin/bash

# Exit on error
set -e

# Disable corepack strict to avoid packageManager issues when installing in cloned repos
export COREPACK_ENABLE_STRICT=0

BENCHMARK_DIR="benchmarks/projects"
mkdir -p "$BENCHMARK_DIR"

# Project URLs and Commits
SMALL_REPO="https://github.com/alan2207/bulletproof-react"
SMALL_COMMIT="c66ea06" # A stable point

MID_REPO="https://github.com/gothinkster/react-redux-realworld-example-app"
MID_COMMIT="ee72eba4056392c95a27bc48d385d3f54ba38a18"

LARGE_REPO="https://github.com/mattermost/mattermost-webapp"
LARGE_COMMIT="149cb00b8282fbf3c31a82ed31b1be4d0b660883"

echo "### Setting up Benchmark Projects ###"

# Function to clone and configure
setup_project() {
    local name=$1
    local repo=$2
    local commit=$3
    local target="$BENCHMARK_DIR/$name"

    if [ ! -d "$target" ]; then
        echo "Cloning $name..."
        git clone "$repo" "$target"
        if [ -n "$commit" ]; then
            echo "Checking out $commit..."
            cd "$target" && git checkout "$commit" && cd - > /dev/null
        fi
    else
        echo "$name already exists, skipping clone."
    fi

    echo "Configuring $name..."
    # Determine the project root (where package.json is)
    local project_root="$target"
    if [ "$name" == "small" ]; then
        project_root="$target/apps/react-vite"
    fi

    # Create react.map.config.json in the project root
    cat <<EOF > "$project_root/react.map.config.json"
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

    # Apply fixes to package.json for the 'small' project
    if [ "$name" == "small" ]; then
        echo "Applying environment fixes to $name project..."
        # Downgrade TypeScript and lock ESLint to v8
        sed -i '' 's/"typescript": "\^5.4.5"/"typescript": "5.5.4"/g' "$project_root/package.json"
        sed -i '' 's/"eslint": "8"/"eslint": "8.57.1"/g' "$project_root/package.json"
        # Strip Corepack's packageManager property from all package.json files to avoid Yarn version mismatch errors
        find benchmarks/projects/small -name "package.json" -exec sed -i '' '/"packageManager"/d' {} +
        # Delete root package.json if it's there to prevent workspace overrides during setup
        rm -f "benchmarks/projects/small/package.json"
        
        # Enable corepack globally just in case, or run yarn internally with latest
        if command -v corepack >/dev/null 2>&1; then
            corepack enable || true
        fi
        
        # Also ensure we have a Playwright test
        mkdir -p "$project_root/e2e/tests"
        cat <<EOF > "$project_root/e2e/tests/button-size.spec.ts"
import { test, expect } from '@playwright/test';

test('button has correct size classes', async ({ page }) => {
  await page.goto('/');
  // Wait for the page to load
  await page.waitForLoadState('networkidle');
  
  const button = page.getByRole('button', { name: /get started/i }).first();
  await expect(button).toBeVisible();
  
  // Check for size classes (default is md)
  const className = await button.getAttribute('class');
  expect(className).toContain('h-10');
});
EOF
    fi

    # Apply fixes for 'mid' project
    if [ "$name" == "mid" ]; then
        echo "Applying environment fixes to $name project..."
        # Create .eslintrc.js as it's missing but react-scripts expects it or we need it for standalone lint
        cat <<EOF > "$project_root/.eslintrc.js"
module.exports = {
  extends: ['react-app'],
  rules: {
    'no-unused-vars': 'off', // Be lenient for benchmarks
  }
};
EOF
        # Install playwright
        echo "Adding Playwright to $name project..."
        sed -i '' 's/"devDependencies": {/"devDependencies": {\n    "@playwright\/test": "^1.49.0",/g' "$project_root/package.json"
        
        # Create playwright.config.ts for mid
        cat <<EOF > "$project_root/playwright.config.ts"
import { defineConfig, devices } from '@playwright/test';
const PORT = 4100;
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm start',
    port: PORT,
    timeout: 30 * 1000,
    reuseExistingServer: !process.env.CI,
  },
});
EOF
        mkdir -p "$project_root/e2e"
        cat <<EOF > "$project_root/e2e/header.spec.ts"
import { test, expect } from '@playwright/test';

test('navigation links are present and correct', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  
  // Check Brand link
  const brand = page.locator('.navbar-brand');
  await expect(brand).toBeVisible();
  
  // Check Home link
  const homeLink = page.getByRole('link', { name: /home/i });
  await expect(homeLink).toBeVisible();
  
  // Check Sign in link
  const signinLink = page.getByRole('link', { name: /sign in/i });
  await expect(signinLink).toBeVisible();
  
  // Check Sign up link
  const signupLink = page.getByRole('link', { name: /sign up/i });
  await expect(signupLink).toBeVisible();
});
EOF
    fi

    # Apply fixes for 'large' project (Mattermost)
    if [ "$name" == "large" ]; then
        echo "Adding Playwright to $name project..."
        # Mattermost is huge, so we just want a basic E2E setup for verification
        # Install playwright
        sed -i '' 's/"devDependencies": {/"devDependencies": {\n    "@playwright\/test": "^1.49.0",/g' "$project_root/package.json"

        # Create playwright.config.ts for large
        cat <<EOF > "$project_root/playwright.config.ts"
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // We don't run a live server for Mattermost as it's too complex
  // Instead we can use this for component testing or static analysis if needed
  // or just skip live tests for now.
});
EOF
        mkdir -p "$project_root/e2e"
        cat <<EOF > "$project_root/e2e/smoke.spec.ts"
import { test, expect } from '@playwright/test';

test('smoke test', async () => {
  // Just a placeholder to ensure playwright works
  expect(true).toBe(true);
});
EOF
    fi

    echo "Installing dependencies in $project_root..."
    cd "$project_root"
    rm -rf node_modules
    
    # If a root pnpm-lock.yaml exists and we are in a sub-app, we might need to install from root 
    # to avoid workspace errors, but React Map clones specific repos differently.
    # The safest way is to try the project's preferred package manager explicitly.
    if [[ "$project_root" == *"small"* ]]; then
        # The 'small' project uses Corepack with Yarn 1 which fails spectacularly depending on host NPM versions
        # Bypassing completely to just use standard NPM
        npm install --no-package-lock --ignore-scripts
    elif [ -f "pnpm-lock.yaml" ] || [ -f "../../pnpm-lock.yaml" ]; then
        if command -v pnpm >/dev/null 2>&1; then
            pnpm install --ignore-scripts
        else
            npm install --no-package-lock --ignore-scripts
        fi
    elif [ -f "yarn.lock" ] || [ -f "../../yarn.lock" ]; then
        if command -v yarn >/dev/null 2>&1; then
           if command -v corepack >/dev/null 2>&1; then
               corepack disable || true
           fi
           # Some node versions require COREPACK_ENABLE_STRICT=0, others might ignore Corepack entirely when disabled.
           # Let's use npm specifically if yarn keeps getting hijacked by Corepack.
           COREPACK_ENABLE_STRICT=0 yarn install --ignore-scripts || npm install --no-package-lock --ignore-scripts
        else
           npm install --no-package-lock --ignore-scripts
        fi
    else
        npm install --no-package-lock --ignore-scripts
    fi
    
    echo "Installing Playwright browsers..."
    npx playwright install chromium
    
    cd - > /dev/null

    # Add a commit so cleanup commands (git checkout .) work against this baseline
    cd "$target"
    git add .
    git config user.email "benchmark@react-map.com"
    git config user.name "Benchmark Runner"
    # Commit changes (including node_modules if not ignored, but usually they are)
    # We want to commit the configuration and any changes made during setup.
    git commit -m "chore: baseline for react-map benchmark" || echo "Baseline already committed or no changes."
    cd - > /dev/null
}

setup_project "small" "$SMALL_REPO" "$SMALL_COMMIT"
setup_project "mid" "$MID_REPO" "$MID_COMMIT"
setup_project "large" "$LARGE_REPO" "$LARGE_COMMIT"

echo "### Setup Complete ###"

echo "Projects are located in $BENCHMARK_DIR"
