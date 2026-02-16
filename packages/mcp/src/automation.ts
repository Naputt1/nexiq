import { _electron as electron, type ElectronApplication, type Page } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../../../");

let electronApp: ElectronApplication | null = null;
let page: Page | null = null;

export async function getPage(): Promise<Page> {
  if (page) return page;

  const electronPath = path.join(ROOT, "packages/ui/node_modules/.bin/electron");
  const mainPath = path.join(ROOT, "packages/ui/dist-electron/main.js");

  electronApp = await electron.launch({
    executablePath: electronPath,
    args: [mainPath],
  });

  page = await electronApp.firstWindow();
  return page;
}

export async function screenshot(): Promise<string> {
  const p = await getPage();
  const buffer = await p.screenshot();
  return buffer.toString("base64");
}

export async function click(selectorOrPos: string | { x: number; y: number }): Promise<void> {
  const p = await getPage();
  if (typeof selectorOrPos === "string") {
    await p.click(selectorOrPos);
  } else {
    await p.mouse.click(selectorOrPos.x, selectorOrPos.y);
  }
}

export async function drag(from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  const p = await getPage();
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(to.x, to.y, { steps: 10 });
  await p.mouse.up();
}

export async function hover(selectorOrPos: string | { x: number; y: number }): Promise<void> {
  const p = await getPage();
  if (typeof selectorOrPos === "string") {
    await p.hover(selectorOrPos);
  } else {
    await p.mouse.move(selectorOrPos.x, selectorOrPos.y);
  }
}

export async function pressKey(key: string): Promise<void> {
  const p = await getPage();
  await p.keyboard.press(key);
}

export async function getGraphData(): Promise<any> {
  const p = await getPage();
  return await p.evaluate(() => {
    const graph = (window as any).reactMapGraph;
    if (!graph) return { error: "Graph not initialized" };
    return {
      nodes: graph.getAllNodes().map((n: any) => ({
        id: n.id,
        label: n.label?.text,
        x: n.x,
        y: n.y,
        kind: n.kind,
      })),
      combos: graph.getAllCombos().map((c: any) => ({
        id: c.id,
        label: c.label?.text,
        x: c.x,
        y: c.y,
      })),
      edges: graph.getAllEdges().map((e: any) => ({
        id: e.id,
        source: e.source,
        target: e.target,
      })),
    };
  });
}

export async function searchGraph(query: string): Promise<any> {
  const p = await getPage();
  return await p.evaluate((q) => {
    const search = (window as any).reactMapSearch;
    if (!search) return { error: "Search function not found" };
    search(q);
    // After search, the matches are in the state, but we can't easily get them back
    // unless we also expose the state or the result.
    // Let's assume performSearch updates the UI and we return what's highlighted.
    const graph = (window as any).reactMapGraph;
    const nodes = graph.getAllNodes().filter((n: any) => n.highlighted).map((n: any) => n.id);
    const combos = graph.getAllCombos().filter((c: any) => c.highlighted).map((c: any) => c.id);
    return { nodes, combos };
  }, query);
}

export async function close(): Promise<void> {
  if (electronApp) {
    await electronApp.close();
    electronApp = null;
    page = null;
  }
}
