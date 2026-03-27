import { describe, it, expect } from "vitest";
import { componentTask } from "./componentTask.js";
import {
  type DatabaseData,
  type GraphViewResult,
  type TaskContext,
  type GraphNodeData,
  type GraphComboData,
  type GraphArrowData,
} from "../index.js";

describe("componentTask", () => {
  const mockData: DatabaseData = {
    // ... rest of mockData remains same, I will use a concise replacement
    files: [
      {
        id: 1,
        path: "/src/App.tsx",
        hash: "1",
        fingerprint: "1",
        default_export: null,
        star_exports_json: null,
        package_id: null,
      },
      {
        id: 2,
        path: "/src/Comp.tsx",
        hash: "2",
        fingerprint: "2",
        default_export: null,
        star_exports_json: null,
        package_id: null,
      },
    ],
    entities: [
      {
        id: "e-comp",
        scope_id: "s-comp-module",
        kind: "component",
        name: "Comp",
        type: "function",
        line: 1,
        column: 1,
        end_line: 10,
        end_column: 1,
        declaration_kind: "const",
        data_json: null,
      },
      {
        id: "e-import",
        scope_id: "s-app-module",
        kind: "import",
        name: "Comp",
        type: "data",
        line: 1,
        column: 1,
        end_line: 1,
        end_column: 1,
        declaration_kind: null,
        data_json: JSON.stringify({
          source: "/src/Comp.tsx",
          importedName: "Comp",
          type: "named",
        }),
      },
      {
        id: "e-app",
        scope_id: "s-app-module",
        kind: "component",
        name: "App",
        type: "function",
        line: 5,
        column: 1,
        end_line: 15,
        end_column: 1,
        declaration_kind: "const",
        data_json: null,
      },
    ],
    scopes: [
      {
        id: "s-comp-module",
        file_id: 2,
        parent_id: null,
        kind: "module",
        entity_id: null,
        data_json: null,
      },
      {
        id: "s-comp-block",
        file_id: 2,
        parent_id: "s-comp-module",
        kind: "block",
        entity_id: "e-comp",
        data_json: null,
      },
      {
        id: "s-app-module",
        file_id: 1,
        parent_id: null,
        kind: "module",
        entity_id: null,
        data_json: null,
      },
      {
        id: "s-app-block",
        file_id: 1,
        parent_id: "s-app-module",
        kind: "block",
        entity_id: "e-app",
        data_json: null,
      },
    ],
    symbols: [
      {
        id: "sym-comp",
        entity_id: "e-comp",
        scope_id: "s-comp-module",
        name: "Comp",
        path: null,
        is_alias: 0,
        has_default: 0,
        data_json: null,
      },
      {
        id: "sym-import",
        entity_id: "e-import",
        scope_id: "s-app-module",
        name: "Comp",
        path: null,
        is_alias: 0,
        has_default: 0,
        data_json: null,
      },
      {
        id: "sym-app",
        entity_id: "e-app",
        scope_id: "s-app-module",
        name: "App",
        path: null,
        is_alias: 0,
        has_default: 0,
        data_json: null,
      },
    ],
    renders: [
      {
        id: "r-1",
        file_id: 1,
        parent_entity_id: "e-app",
        parent_render_id: null,
        render_index: 0,
        tag: "Comp",
        symbol_id: "sym-import",
        line: 10,
        column: 5,
        kind: "jsx",
        data_json: null,
      },
      {
        id: "r-2",
        file_id: 1,
        parent_entity_id: "e-app",
        parent_render_id: "r-1",
        render_index: 0,
        tag: "div",
        symbol_id: null,
        line: 11,
        column: 10,
        kind: "jsx",
        data_json: null,
      },
    ],
    exports: [
      {
        id: "exp-1",
        scope_id: "s-comp-module",
        symbol_id: "sym-comp",
        entity_id: "e-comp",
        name: "Comp",
        is_default: 0,
      },
    ],
    relations: [
      {
        from_id: "sym-app",
        to_id: "sym-import",
        kind: "usage",
        line: 10,
        column: 5,
        data_json: null,
      },
    ],
    packages: [],
    package_dependencies: [],
  };

  const initialResult: GraphViewResult = {
    nodes: [],
    combos: [],
    edges: [],
    typeData: {},
  };

  it("should skip automatic JSX symbols and their scopes", () => {
    const dataWithJsx = {
      ...mockData,
      symbols: [
        ...mockData.symbols,
        {
          id: "sym-jsx",
          entity_id: "e-jsx",
          scope_id: "s-app-block",
          name: "jsx@8:4",
          path: null,
          is_alias: 0,
          has_default: 0,
          data_json: null,
        },
      ],
      entities: [
        ...mockData.entities,
        {
          id: "e-jsx",
          scope_id: "s-app-block",
          kind: "normal",
          name: "jsx@8:4",
          type: "jsx",
          line: 8,
          column: 4,
          end_line: 8,
          end_column: 10,
          declaration_kind: null,
          data_json: null,
        },
      ],
      scopes: [
        ...mockData.scopes,
        {
          id: "s-jsx-block",
          file_id: 1,
          parent_id: "s-app-block",
          kind: "block",
          entity_id: "e-jsx",
          data_json: null,
        },
      ],
    };

    const context: TaskContext = {
      projectRoot: "/",
      viewType: "component",
      snapshotData: dataWithJsx,
    };
    const result = componentTask.run(initialResult, context);

    // Verify symbol node is skipped
    const jsxNode = result.nodes.find(
      (n: GraphNodeData) => n.name === "jsx@8:4",
    );
    expect(jsxNode).toBeUndefined();

    // Verify scope combo is skipped
    const jsxScope = result.combos.find(
      (c: GraphComboData) => c.id === "s-jsx-block",
    );
    expect(jsxScope).toBeUndefined();
  });

  it("should hide import nodes and redirect relations", () => {
    const context: TaskContext = {
      projectRoot: "/",
      viewType: "component",
      snapshotData: mockData,
    };
    const result = componentTask.run(initialResult, context);

    // Verify import node is NOT present
    const importNode = result.nodes.find(
      (n: GraphNodeData) => n.id === "sym-import",
    );
    const importCombo = result.combos.find(
      (c: GraphComboData) => c.id === "sym-import",
    );
    expect(importNode).toBeUndefined();
    expect(importCombo).toBeUndefined();

    // Verify relation is redirected from sym-app to sym-comp
    // Step 4 logic: const edgeId = `${sourceId}-${targetId}-${rel.kind}`;
    const edgeId = "sym-app-sym-comp-usage";
    const edge = result.edges.find((e: GraphArrowData) => e.id === edgeId);
    expect(edge).toBeDefined();
    expect(edge?.source).toBe("sym-app");
    expect(edge?.target).toBe("sym-comp");
  });

  it("should use tag name for top-level JSX label and stack correctly", () => {
    const context: TaskContext = {
      projectRoot: "/",
      viewType: "component",
      snapshotData: mockData,
    };
    const result = componentTask.run(initialResult, context);

    const renderGroup = result.combos.find(
      (c: GraphComboData) => c.id === "render-group-s-app-block",
    );
    expect(renderGroup).toBeDefined();
    expect(renderGroup?.name).toBe("render");
    expect(renderGroup?.combo).toBe("s-app-block");

    const compRender = result.combos.find(
      (c: GraphComboData) => c.id === "r-1",
    );
    expect(compRender).toBeDefined();
    expect(compRender?.label?.text).toBe("Comp");
    expect(compRender?.combo).toBe("render-group-s-app-block");

    const divRender = result.combos.find((c: GraphComboData) => c.id === "r-2");
    expect(divRender).toBeDefined();
    expect(divRender?.label?.text).toBe("div");
    expect(divRender?.combo).toBe("r-1"); // Nested inside r-1
  });

  it("should show effect nodes and their dependencies", () => {
    const dataWithEffect: DatabaseData = {
      ...mockData,
      entities: mockData.entities.map((e) => {
        if (e.id === "e-app") {
          return {
            ...e,
            data_json: JSON.stringify({
              effects: {
                "e-app:effect:10:5": {
                  id: "e-app:effect:10:5",
                  loc: { line: 10, column: 5 },
                  reactDeps: [{ id: "sym-import", name: "Comp" }],
                },
              },
            }),
          };
        }
        return e;
      }),
    };

    const context: TaskContext = {
      projectRoot: "/",
      viewType: "component",
      snapshotData: dataWithEffect,
    };
    const result = componentTask.run(initialResult, context);

    const effectNode = result.nodes.find(
      (n: GraphNodeData) => n.id === "e-app:effect:10:5",
    );
    expect(effectNode).toBeDefined();
    expect(effectNode?.name).toBe("useEffect");
    expect(effectNode?.combo).toBe("s-app-block");

    // Verify dependency edge (sym-import should be redirected to sym-comp, arrow points FROM dependency TO consumer)
    const depEdge = result.edges.find(
      (e: GraphArrowData) => e.id === "sym-comp-e-app:effect:10:5-effect-dep",
    );
    expect(depEdge).toBeDefined();
    expect(depEdge?.source).toBe("sym-comp");
    expect(depEdge?.target).toBe("e-app:effect:10:5");
  });

  it("should show dependencies for hooks like useMemo", () => {
    const dataWithMemo: DatabaseData = {
      ...mockData,
      entities: [
        ...mockData.entities,
        {
          id: "e-memo",
          scope_id: "s-app-block",
          kind: "hook",
          name: "memoVal",
          type: "data",
          line: 12,
          column: 5,
          end_line: 12,
          end_column: 20,
          declaration_kind: "const",
          data_json: JSON.stringify({
            reactDeps: [{ id: "sym-import", name: "Comp" }],
          }),
        },
      ],
      symbols: [
        ...mockData.symbols,
        {
          id: "sym-memo",
          entity_id: "e-memo",
          scope_id: "s-app-block",
          name: "memoVal",
          path: null,
          is_alias: 0,
          has_default: 0,
          data_json: null,
        },
      ],
    };

    const context: TaskContext = {
      projectRoot: "/",
      viewType: "component",
      snapshotData: dataWithMemo,
    };
    const result = componentTask.run(initialResult, context);

    const memoNode = result.nodes.find(
      (n: GraphNodeData) => n.id === "sym-memo",
    );
    expect(memoNode).toBeDefined();

    // Verify dependency edge (arrow points FROM dependency TO consumer)
    const depEdge = result.edges.find(
      (e: GraphArrowData) => e.id === "sym-comp-sym-memo-react-dep",
    );
    expect(depEdge).toBeDefined();
    expect(depEdge?.source).toBe("sym-comp");
    expect(depEdge?.target).toBe("sym-memo");
  });

  it("should show useLayoutEffect nodes", () => {
    const dataWithEffect: DatabaseData = {
      ...mockData,
      entities: mockData.entities.map((e) => {
        if (e.id === "e-app") {
          return {
            ...e,
            data_json: JSON.stringify({
              effects: {
                "e-app:effect:10:5": {
                  id: "e-app:effect:10:5",
                  name: "useLayoutEffect",
                  loc: { line: 10, column: 5 },
                  reactDeps: [],
                },
              },
            }),
          };
        }
        return e;
      }),
    };

    const context: TaskContext = {
      projectRoot: "/",
      viewType: "component",
      snapshotData: dataWithEffect,
    };
    const result = componentTask.run(initialResult, context);

    const effectNode = result.nodes.find(
      (n: GraphNodeData) => n.id === "e-app:effect:10:5",
    );
    expect(effectNode).toBeDefined();
    expect(effectNode?.name).toBe("useLayoutEffect");
    expect(effectNode?.label?.text).toBe("useLayoutEffect");
  });

  it("should show improved labels for useState and useRef", () => {
    const dataWithState: DatabaseData = {
      ...mockData,
      entities: [
        ...mockData.entities,
        {
          id: "e-state",
          scope_id: "s-app-block",
          kind: "state",
          name: "count",
          type: "data",
          line: 6,
          column: 5,
          end_line: 6,
          end_column: 15,
          declaration_kind: "const",
          data_json: JSON.stringify({ setter: "setCount" }),
        },
        {
          id: "e-ref",
          scope_id: "s-app-block",
          kind: "ref",
          name: "myRef",
          type: "data",
          line: 7,
          column: 5,
          end_line: 7,
          end_column: 15,
          declaration_kind: "const",
          data_json: JSON.stringify({}),
        },
      ],
      symbols: [
        ...mockData.symbols,
        {
          id: "sym-state",
          entity_id: "e-state",
          scope_id: "s-app-block",
          name: "count",
          path: JSON.stringify(["0"]),
          is_alias: 0,
          has_default: 0,
          data_json: null,
        },
        {
          id: "sym-setter",
          entity_id: "e-state",
          scope_id: "s-app-block",
          name: "setCount",
          path: JSON.stringify(["1"]),
          is_alias: 0,
          has_default: 0,
          data_json: null,
        },
        {
          id: "sym-ref",
          entity_id: "e-ref",
          scope_id: "s-app-block",
          name: "myRef",
          path: null,
          is_alias: 0,
          has_default: 0,
          data_json: null,
        },
      ],
    };

    const context: TaskContext = {
      projectRoot: "/",
      viewType: "component",
      snapshotData: dataWithState,
    };
    const result = componentTask.run(initialResult, context);

    const stateNode = result.nodes.filter(
      (n: GraphNodeData) => n.id === "sym-state" || n.id === "sym-setter",
    );
    expect(stateNode.length).toBe(1);
    expect(stateNode[0].id).toBe("sym-state");
    expect(stateNode[0].label?.text).toBe("count");

    const refNode = result.nodes.find((n: GraphNodeData) => n.id === "sym-ref");
    expect(refNode).toBeDefined();
    expect(refNode?.label?.text).toBe("myRef");
  });

  it("should group destructured variables by their path", () => {
    const dataWithDestructuring: DatabaseData = {
      ...mockData,
      entities: [
        ...mockData.entities,
        {
          id: "e-hook-call",
          scope_id: "s-app-block",
          kind: "hook",
          name: "useTable",
          type: "data",
          line: 20,
          column: 5,
          end_line: 20,
          end_column: 30,
          declaration_kind: "const",
          data_json: null,
        },
      ],
      symbols: [
        ...mockData.symbols,
        {
          id: "sym-rows",
          entity_id: "e-hook-call",
          scope_id: "s-app-block",
          name: "rows",
          path: JSON.stringify(["rows"]),
          is_alias: 0,
          has_default: 0,
          data_json: null,
        },
        {
          id: "sym-orig",
          entity_id: "e-hook-call",
          scope_id: "s-app-block",
          name: "original",
          path: JSON.stringify(["rows", "0", "original"]),
          is_alias: 0,
          has_default: 0,
          data_json: null,
        },
      ],
    };

    const context: TaskContext = {
      projectRoot: "/",
      viewType: "component",
      snapshotData: dataWithDestructuring,
    };
    const result = componentTask.run(initialResult, context);

    // Verify 'rows' node
    const rowsNode = result.nodes.find(
      (n: GraphNodeData) => n.id === "sym-rows",
    );
    expect(rowsNode).toBeDefined();
    expect(rowsNode?.combo).toBe("s-app-block:source:e-hook-call"); // First layer grouped under source

    // Verify source combo
    const sourceCombo = result.combos.find(
      (c: GraphComboData) => c.id === "s-app-block:source:e-hook-call",
    );
    expect(sourceCombo).toBeDefined();
    expect(sourceCombo?.name).toBe("useTable");
    expect(sourceCombo?.combo).toBe("s-app-block");

    // Verify 'original' node and intermediate combos
    const origNode = result.nodes.find(
      (n: GraphNodeData) => n.id === "sym-orig",
    );
    expect(origNode).toBeDefined();

    // Path ["rows", "0", "original"]
    // Source: s-app-block:source:e-hook-call
    // Combo 1: s-app-block:source:e-hook-call:path:rows
    // Combo 2: s-app-block:source:e-hook-call:path:rows/0

    expect(origNode?.combo).toBe("s-app-block:source:e-hook-call:path:rows/0");

    const combo0 = result.combos.find(
      (c: GraphComboData) =>
        c.id === "s-app-block:source:e-hook-call:path:rows/0",
    );
    expect(combo0).toBeDefined();
    expect(combo0?.name).toBe("0");
    expect(combo0?.combo).toBe("s-app-block:source:e-hook-call:path:rows");

    const comboRows = result.combos.find(
      (c: GraphComboData) =>
        c.id === "s-app-block:source:e-hook-call:path:rows",
    );
    expect(comboRows).toBeDefined();
    expect(comboRows?.name).toBe("rows");
    expect(comboRows?.combo).toBe("s-app-block:source:e-hook-call");
  });
});
