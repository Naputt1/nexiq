import { test, expect } from "./electron.fixture";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test.describe("App Setup and Basic Navigation", () => {
  test("should show welcome screen on first run", async ({ page }) => {
    // Check for welcome text
    const welcomeHeading = page.getByText("Welcome to React Map");
    await expect(welcomeHeading).toBeVisible();

    const openFolderBtn = page.getByRole("button", {
      name: "Open Project Folder",
    });
    await expect(openFolderBtn).toBeVisible();
  });

  test("should show recent projects section", async ({ page }) => {
    const recentProjects = page.getByRole("heading", { name: "Recent Projects" });
    await expect(recentProjects).toBeVisible();
  });
});

test.describe("Graph Interaction", () => {
  test("should render the graph container when navigating directly", async ({
    page,
  }) => {
    const samplePath = path.resolve(__dirname, "../../../packages/sample-project/simple");

    // Navigate via hash
    await page.evaluate((p) => {
      window.location.hash = `/?projectPath=${encodeURIComponent(p)}`;
    }, samplePath);

    // Wait for graph to load (canvas element)
    // Konva uses multiple canvases, we just need one to be visible
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20000 });
  });

  test("should show sidebar components", async ({ page }) => {
    const samplePath = path.resolve(__dirname, "../../../packages/sample-project/simple");
    await page.evaluate((p) => {
      window.location.hash = `/?projectPath=${encodeURIComponent(p)}`;
    }, samplePath);

    // Ensure the sidebar is open
    const sidebar = page.locator("aside");
    const trigger = page.locator("button[data-sidebar='trigger']");
    
    // Wait for canvas to ensure page has transitioned
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 20000 });

    if (!(await sidebar.isVisible())) {
      await trigger.click();
    }

    await expect(page.getByText("Explorer", { exact: true })).toBeVisible({ timeout: 10000 });
  });

  test("should open search via keyboard shortcut", async ({ page }) => {
    const samplePath = path.resolve(__dirname, "../../../packages/sample-project/simple");
    await page.evaluate((p) => {
      window.location.hash = `/?projectPath=${encodeURIComponent(p)}`;
    }, samplePath);

    // Wait for initial load
    await page.waitForTimeout(1000);

    // Press Cmd+F (or Ctrl+F)
    await page.keyboard.press("Control+f");

    const searchInput = page.getByPlaceholder("Find");
    await expect(searchInput).toBeVisible();
  });
});
