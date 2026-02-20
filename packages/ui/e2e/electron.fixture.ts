import { _electron as electron, test as base, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ElectronFixture = {
  electronApp: any;
  page: Page;
};

export const test = base.extend<ElectronFixture>({
  electronApp: async ({}, use) => {
    // Determine path to main file
    // In dev mode, we point to the entry or the built dist-electron
    const electronPath = path.join(__dirname, "..", "dist-electron", "main.js");
    
    const electronApp = await electron.launch({
      args: [electronPath],
      env: {
        ...process.env,
        VITE_COVERAGE: "true",
        NODE_ENV: "development",
      },
    });

    await use(electronApp);

    // After all tests in this file, collect coverage if possible
    // This is handled per test in the 'page' fixture below for better granularity
    await electronApp.close();
  },
  page: async ({ electronApp }, use, testInfo) => {
    const page = await electronApp.firstWindow();
    
    // Wait for the window to be ready
    await page.waitForLoadState("domcontentloaded");

    await use(page);

    // Collect coverage after each test
    const coverage: any = await page.evaluate(() => (window as any).__coverage__);
    if (coverage) {
      const coverageDir = path.join(__dirname, "coverage");
      if (!fs.existsSync(coverageDir)) {
        fs.mkdirSync(coverageDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(coverageDir, `coverage-${testInfo.testId}.json`),
        JSON.stringify(coverage),
      );
    }
  },
});

export { expect } from "@playwright/test";
