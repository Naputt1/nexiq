import { describe, it, expect } from "vitest";
import { componentTask } from "./componentTask.js";
import { type DatabaseData, type GraphViewResult } from "../index.js";

describe("componentTask", () => {
  const mockData: DatabaseData = {
    files: [
      { id: 1, path: "/src/App.tsx", hash: "1", fingerprint: "1", default_export: null, star_exports_json: null },
      { id: 2, path: "/src/Comp.tsx", hash: "2", fingerprint: "2", default_export: null, star_exports_json: null },
    ],
    entities: [
      { id: "e-comp", scope_id: "s-comp-module", kind: "component", name: "Comp", type: "function", line: 1, column: 1, end_line: 10, end_column: 1, declaration_kind: "const", data_json: null },
      { id: "e-import", scope_id: "s-app-module", kind: "import", name: "Comp", type: "data", line: 1, column: 1, end_line: 1, end_column: 1, declaration_kind: null, data_json: JSON.stringify({ source: "/src/Comp.tsx", importedName: "Comp", type: "named" }) },
      { id: "e-app", scope_id: "s-app-module", kind: "component", name: "App", type: "function", line: 5, column: 1, end_line: 15, end_column: 1, declaration_kind: "const", data_json: null },
    ],
    scopes: [
      { id: "s-comp-module", file_id: 2, parent_id: null, kind: "module", entity_id: null, data_json: null },
      { id: "s-comp-block", file_id: 2, parent_id: "s-comp-module", kind: "block", entity_id: "e-comp", data_json: null },
      { id: "s-app-module", file_id: 1, parent_id: null, kind: "module", entity_id: null, data_json: null },
      { id: "s-app-block", file_id: 1, parent_id: "s-app-module", kind: "block", entity_id: "e-app", data_json: null },
    ],
    symbols: [
      { id: "sym-comp", entity_id: "e-comp", scope_id: "s-comp-module", name: "Comp", path: null, is_alias: 0, has_default: 0, data_json: null },
      { id: "sym-import", entity_id: "e-import", scope_id: "s-app-module", name: "Comp", path: null, is_alias: 0, has_default: 0, data_json: null },
      { id: "sym-app", entity_id: "e-app", scope_id: "s-app-module", name: "App", path: null, is_alias: 0, has_default: 0, data_json: null },
    ],
    renders: [
      { id: "r-1", file_id: 1, parent_entity_id: "e-app", parent_render_id: null, render_index: 0, tag: "Comp", symbol_id: "sym-import", line: 10, column: 5, kind: "jsx", data_json: null },
      { id: "r-2", file_id: 1, parent_entity_id: "e-app", parent_render_id: "r-1", render_index: 0, tag: "div", symbol_id: null, line: 11, column: 10, kind: "jsx", data_json: null },
    ],
    exports: [
      { id: "exp-1", scope_id: "s-comp-module", symbol_id: "sym-comp", entity_id: "e-comp", name: "Comp", is_default: 0 },
    ],
    relations: [
      { from_id: "sym-app", to_id: "sym-import", kind: "usage", line: 10, column: 5, data_json: null },
    ],
  };

  const initialResult: GraphViewResult = {
    nodes: [],
    combos: [],
    edges: [],
    typeData: {},
  };

  it("should hide import nodes and redirect relations", () => {
    const result = componentTask.run(mockData, initialResult);

    // Verify import node is NOT present
    const importNode = result.nodes.find(n => n.id === "sym-import");
    const importCombo = result.combos.find(c => c.id === "sym-import");
    expect(importNode).toBeUndefined();
    expect(importCombo).toBeUndefined();

    // Verify relation is redirected from sym-app to sym-comp
    // Step 4 logic: const edgeId = `${sourceId}-${targetId}-${rel.kind}`;
    const edgeId = "sym-app-sym-comp-usage";
    const edge = result.edges.find(e => e.id === edgeId);
    expect(edge).toBeDefined();
    expect(edge?.source).toBe("sym-app");
    expect(edge?.target).toBe("sym-comp");
  });

  it("should use tag name for top-level JSX label and stack correctly", () => {
    const result = componentTask.run(mockData, initialResult);

    const compRender = result.nodes.find(n => n.id === "r-1");
    expect(compRender).toBeDefined();
    expect(compRender?.label?.text).toBe("Comp"); 
    expect(compRender?.combo).toBe("s-app-block");

    const divRender = result.nodes.find(n => n.id === "r-2");
    expect(divRender).toBeDefined();
    expect(divRender?.label?.text).toBe("div");
    expect(divRender?.combo).toBe("s-app-block"); // Sibling of r-1

    // Verify nesting edge
    const nestingEdge = result.edges.find(e => e.id === "r-1-r-2-nesting");
    expect(nestingEdge).toBeDefined();
    expect(nestingEdge?.source).toBe("r-1");
    expect(nestingEdge?.target).toBe("r-2");
    expect(nestingEdge?.label).toBe("nesting");
  });
});
