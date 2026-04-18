
import { describe, it, expect } from "vitest";
import { componentTask } from "../src/componentTask.ts";
import {
  type DatabaseData,
  type TaskContext,
} from "@nexiq/extension-sdk";

describe("componentTask monorepo redirection", () => {
  it("resolves cross-package imports using package names", async () => {
    const mockData: DatabaseData = {
      packages: [
        { id: "pkg-a", name: "@workspace/pkg-a", version: "1.0.0", path: "packages/pkg-a" },
        { id: "pkg-b", name: "@workspace/pkg-b", version: "1.0.0", path: "packages/pkg-b" },
      ],
      files: [
        { id: 1, path: "/packages/pkg-a/src/App.tsx", package_id: "pkg-a", hash: "1", fingerprint: "1", default_export: null, star_exports_json: null },
        { id: 2, path: "/packages/pkg-b/src/Comp.tsx", package_id: "pkg-b", hash: "2", fingerprint: "2", default_export: null, star_exports_json: null },
      ],
      entities: [
        {
          id: "workspace:pkg-b:e-comp",
          scope_id: "workspace:pkg-b:s-comp-module",
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
          id: "workspace:pkg-a:e-import",
          scope_id: "workspace:pkg-a:s-app-module",
          kind: "import",
          name: "Comp",
          type: "data",
          line: 1,
          column: 1,
          end_line: 1,
          end_column: 1,
          declaration_kind: null,
          data_json: JSON.stringify({
            source: "@workspace/pkg-b", // Cross-package import
            importedName: "Comp",
            type: "named",
          }),
        },
      ],
      scopes: [
        { id: "workspace:pkg-b:s-comp-module", file_id: 2, parent_id: null, kind: "module", entity_id: null, data_json: null },
        { id: "workspace:pkg-a:s-app-module", file_id: 1, parent_id: null, kind: "module", entity_id: null, data_json: null },
      ],
      symbols: [
        { id: "workspace:pkg-b:sym-comp", entity_id: "workspace:pkg-b:e-comp", scope_id: "workspace:pkg-b:s-comp-module", name: "Comp", path: null, is_alias: 0, has_default: 0, data_json: null },
        { id: "workspace:pkg-a:sym-import", entity_id: "workspace:pkg-a:e-import", scope_id: "workspace:pkg-a:s-app-module", name: "Comp", path: null, is_alias: 0, has_default: 0, data_json: null },
      ],
      renders: [
        {
          id: "workspace:pkg-a:r-1",
          file_id: 1,
          parent_entity_id: "workspace:pkg-a:e-app", // Not strictly needed for this test
          parent_render_id: null,
          render_index: 0,
          tag: "Comp",
          symbol_id: "workspace:pkg-a:sym-import",
          line: 10,
          column: 5,
          kind: "jsx",
          data_json: null,
        },
      ],
      exports: [
        {
          id: "workspace:pkg-b:exp-1",
          scope_id: "workspace:pkg-b:s-comp-module",
          symbol_id: "workspace:pkg-b:sym-comp",
          entity_id: "workspace:pkg-b:e-comp",
          name: "Comp",
          is_default: 0,
        },
      ],
      relations: [],
    };

    const context: TaskContext = {
      projectRoot: "/root",
      viewType: "component",
      snapshotData: mockData,
    };

    const result = componentTask.run!({ nodes: [], edges: [], combos: [], typeData: {}, details: {} }, context);

    // Verify that the render of Comp points to the definition in pkg-b
    const edge = result.edges.find(e => e.source === "workspace:pkg-a:r-1" && e.target === "workspace:pkg-b:sym-comp");
    // Wait, componentTask doesn't add reference edges for renders anymore?
    // It uses redirectionMap for relations.
    
    // Actually, I should check if redirectionMap was built correctly.
    // Since redirectionMap is internal to run, I'll check the result of a relation that uses it.
    
    // Add a usage relation to mockData
    mockData.relations.push({
        from_id: "workspace:pkg-a:sym-caller", // Some node in pkg-a
        to_id: "workspace:pkg-a:sym-import", // import of Comp
        kind: "usage-call",
        line: 10,
        column: 5,
        data_json: null
    });
    // Add the caller symbol
    mockData.symbols.push({ id: "workspace:pkg-a:sym-caller", entity_id: "e-caller", scope_id: "workspace:pkg-a:s-app-module", name: "caller", path: null, is_alias: 0, has_default: 0, data_json: null });
    mockData.entities.push({ id: "e-caller", scope_id: "workspace:pkg-a:s-app-module", kind: "component", name: "caller", type: "function", line: 5, column: 1, end_line: 15, end_column: 1, declaration_kind: "const", data_json: null });

    const result2 = componentTask.run!({ nodes: [], edges: [], combos: [], typeData: {}, details: {} }, context);
    
    const usageEdge = result2.edges.find(e => e.edgeKind === "usage-call");
    expect(usageEdge).toBeDefined();
    expect(usageEdge?.source).toBe("workspace:pkg-a:sym-caller");
    expect(usageEdge?.target).toBe("workspace:pkg-b:sym-comp"); // Should be redirected!
  });

  it("resolves package-relative imports to root-relative paths", async () => {
    const mockData: DatabaseData = {
      packages: [
        { id: "pkg-a", name: "@workspace/pkg-a", version: "1.0.0", path: "packages/pkg-a" },
      ],
      files: [
        { id: 1, path: "/packages/pkg-a/src/App.tsx", package_id: "pkg-a", hash: "1", fingerprint: "1", default_export: null, star_exports_json: null },
        { id: 2, path: "/packages/pkg-a/src/Comp.tsx", package_id: "pkg-a", hash: "2", fingerprint: "2", default_export: null, star_exports_json: null },
      ],
      entities: [
        {
          id: "workspace:pkg-a:e-comp",
          scope_id: "workspace:pkg-a:s-comp-module",
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
          id: "workspace:pkg-a:e-import",
          scope_id: "workspace:pkg-a:s-app-module",
          kind: "import",
          name: "Comp",
          type: "data",
          line: 1,
          column: 1,
          end_line: 1,
          end_column: 1,
          declaration_kind: null,
          data_json: JSON.stringify({
            source: "/src/Comp.tsx", // Package-relative path
            importedName: "Comp",
            type: "named",
          }),
        },
      ],
      scopes: [
        { id: "workspace:pkg-a:s-comp-module", file_id: 2, parent_id: null, kind: "module", entity_id: null, data_json: null },
        { id: "workspace:pkg-a:s-app-module", file_id: 1, parent_id: null, kind: "module", entity_id: null, data_json: null },
      ],
      symbols: [
        { id: "workspace:pkg-a:sym-comp", entity_id: "workspace:pkg-a:e-comp", scope_id: "workspace:pkg-a:s-comp-module", name: "Comp", path: null, is_alias: 0, has_default: 0, data_json: null },
        { id: "workspace:pkg-a:sym-import", entity_id: "workspace:pkg-a:e-import", scope_id: "workspace:pkg-a:s-app-module", name: "Comp", path: null, is_alias: 0, has_default: 0, data_json: null },
      ],
      exports: [
        {
          id: "workspace:pkg-a:exp-1",
          scope_id: "workspace:pkg-a:s-comp-module",
          symbol_id: "workspace:pkg-a:sym-comp",
          entity_id: "workspace:pkg-a:e-comp",
          name: "Comp",
          is_default: 0,
        },
      ],
      relations: [
        {
            from_id: "workspace:pkg-a:sym-caller",
            to_id: "workspace:pkg-a:sym-import",
            kind: "usage-call",
            line: 10,
            column: 5,
            data_json: null
        }
      ],
    };
    // Add the caller symbol
    mockData.symbols.push({ id: "workspace:pkg-a:sym-caller", entity_id: "e-caller", scope_id: "workspace:pkg-a:s-app-module", name: "caller", path: null, is_alias: 0, has_default: 0, data_json: null });
    mockData.entities.push({ id: "e-caller", scope_id: "workspace:pkg-a:s-app-module", kind: "component", name: "caller", type: "function", line: 5, column: 1, end_line: 15, end_column: 1, declaration_kind: "const", data_json: null });

    const context: TaskContext = {
      projectRoot: "/root",
      viewType: "component",
      snapshotData: mockData,
    };

    const result = componentTask.run!({ nodes: [], edges: [], combos: [], typeData: {}, details: {} }, context);
    
    const usageEdge = result.edges.find(e => e.edgeKind === "usage-call");
    expect(usageEdge).toBeDefined();
    expect(usageEdge?.target).toBe("workspace:pkg-a:sym-comp"); // Should be redirected from package-relative to root-relative!
  });
});
