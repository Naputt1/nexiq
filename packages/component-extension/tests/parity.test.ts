import { describe, it, expect } from "vitest";
import { componentTask } from "../src/componentTask.js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { decodeGraphViewSnapshot } from "../../../nexiq-ui/src/view-snapshot/codec.js";

const require = createRequire(import.meta.url);
// napi-rs compiled binding
import { runComponentTask } from "../index.cjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Component Task Parity", () => {
  it("should execute TS and Rust approaches without failure", () => {
    // 1. Setup mock database paths
    const mockDbPath = path.resolve(
      __dirname,
      "../../sample-project/sqlite.db",
    );

    // Fake context matching properties from backend natively expected by NAPI
    const context = {
      db: null as any,
      projectRoot: "",
      sqlitePath: mockDbPath,
      viewType: "component",
    };

    // 2. Run TS Task
    // Passing the required empty structures that run(...) recursively populates
    const tsResult = componentTask.run?.(
      { nodes: [], edges: [], combos: [], typeData: {} },
      context as any,
    );

    expect(tsResult?.nodes).toBeDefined();
    expect(Array.isArray(tsResult?.nodes)).toBe(true);

    // 3. Run Native Rust Task
    const rustNodeBuffer = Buffer.alloc(10 * 1024 * 1024);
    const rustDetailBuffer = Buffer.alloc(10 * 1024 * 1024);

    // Execute Native Task (verifies SQLite connection and map/reduce Rust internal algorithms)
    expect(() => {
      runComponentTask(rustNodeBuffer, rustDetailBuffer, context);
    }).not.toThrow();

    // 4. Decode Rust Buffer
    const rustBufferView = decodeGraphViewSnapshot(
      new Uint8Array(rustNodeBuffer),
    );
    const rustResult = rustBufferView.materialize();

    // 5. Compare outputs
    
    // Rust does not yet implement effects or renders processing
    const filteredTsNodes = (tsResult?.nodes || []).filter(
      (n: any) => n.type !== "effect" && n.type !== "render"
    );

    // Nodes
    expect(rustResult.nodes.length).toBe(filteredTsNodes.length);

    // Sort and compare IDs to ensure exact parity
    // Sort and compare IDs and Combos to ensure structural parity
    const mapToIdAndCombo = (arr: any[]) =>
      arr
        .map((i) => ({ id: i.id, combo: i.combo || undefined }))
        .sort((a, b) => a.id.localeCompare(b.id));

    expect(mapToIdAndCombo(rustResult.nodes)).toEqual(
      mapToIdAndCombo(filteredTsNodes),
    );

    // Combos
    const filteredTsCombos = (tsResult?.combos || []).filter(
      (c: any) =>
        c.type !== "props-group" &&
        c.type !== "refs-group" &&
        c.type !== "path-group"
    );

    expect(rustResult.combos.length).toBe(filteredTsCombos.length);
    expect(mapToIdAndCombo(rustResult.combos)).toEqual(
      mapToIdAndCombo(filteredTsCombos),
    );

    // Edges
    const filteredTsEdges = (tsResult?.edges || []).filter(
      (e: any) =>
        e.name !== "dependency" &&
        e.category !== "dependency"
    );

    const getSortedEdgeIds = (arr: any[]) => arr.map((i) => i.id).sort();
    expect(rustResult.edges.length).toBe(filteredTsEdges.length);
    expect(getSortedEdgeIds(rustResult.edges)).toEqual(
      getSortedEdgeIds(filteredTsEdges),
    );

    console.log(
      `Parity match! ${rustResult.nodes.length} nodes, ${rustResult.edges.length} edges validated.`,
    );
  });
});
