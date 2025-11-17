import fs from "fs";
import path from "path";
import { glob } from "glob";
import * as parser from "@babel/parser";
import traverse from "@babel/traverse";
import type { File } from "@babel/types";
import type { State } from "shared";
import * as t from "@babel/types";
import assert from "assert";
import { getVariableComponentName } from "./variable.js";
import { ComponentDB } from "./db/componentDB.js";
import { containsJSX, isHook } from "./utils.js";
import { getViteAliases } from "./vite.js";
import { PackageJson } from "./db/packageJson.js";

const SRC_DIR = process.argv[2] || "./sample-src";
const OUT_FILE = process.argv[3] || "./out/graph.json";
const PUBLIC_FILE = process.argv[4] || "./ui/public/graph.json";

const VITE_CONFIG_FILE = "vite.config.ts";

function getViteConfig(dir: string): string | null {
  const configPath = path.join(dir, VITE_CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    return configPath;
  }

  return null;
}

function getFiles(dir: string): string[] {
  return glob.sync("**/*.{js,jsx,ts,tsx}", {
    cwd: dir,
    absolute: true,
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/out/**",
      "**/coverage/**",
      "**/public/**",
      "**/vite.config.ts",
    ],
  });
}

function parseCode(code: string, filename: string): File {
  return parser.parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript", "classProperties"],
  });
}

function analyzeFiles(
  viteConfigPath: string | null,
  files: string[],
  packageJson: PackageJson
) {
  const componentDB = new ComponentDB({
    packageJson,
    viteAliases: getViteAliases(viteConfigPath),
    dir: SRC_DIR,
  });

  const aliases = getViteAliases(viteConfigPath);

  for (const fileName of files) {
    componentDB.addFile(fileName);
    // console.log(fileName);
    const code = fs.readFileSync(fileName, "utf-8");
    let ast: File;
    try {
      ast = parseCode(code, fileName);
    } catch (e) {
      console.warn(`Skipping ${fileName}: ${(e as Error).message}`);
      continue;
    }

    traverse.default(ast, {
      ImportDeclaration(nodePath) {
        const source = componentDB.getImportFileName(
          nodePath.node.source.value,
          fileName
        );

        const importKind: "value" | "type" =
          nodePath.node.importKind === "type" ? "type" : "value";

        nodePath.node.specifiers.forEach((spec) => {
          if (t.isImportDefaultSpecifier(spec)) {
            componentDB.fileAddImport(fileName, {
              localName: spec.local.name,
              importedName: null,
              source,
              type: "default",
              importKind,
            });
          } else if (t.isImportSpecifier(spec)) {
            let importedName: string | null = null;
            if (t.isIdentifier(spec.imported)) {
              importedName = spec.imported.name;
            } else if (t.isStringLiteral(spec.imported)) {
              importedName = spec.imported.value;
            }

            componentDB.fileAddImport(fileName, {
              localName: spec.local.name,
              importedName,
              source,
              type: "named",
              importKind,
            });
          } else if (t.isImportNamespaceSpecifier(spec)) {
            componentDB.fileAddImport(fileName, {
              localName: spec.local.name,
              importedName: "*",
              source,
              type: "namespace",
              importKind,
            });
          }
        });
      },

      ExportDefaultDeclaration(NodePath) {
        const decl = NodePath.node.declaration;

        if (t.isIdentifier(decl)) {
          componentDB.fileSetDefaultExport(fileName, decl.name);
          return;
        } else if (t.isFunctionDeclaration(decl)) {
          componentDB.fileSetDefaultExport(fileName, decl.id?.name);
          return;
        } else if (
          t.isArrowFunctionExpression(decl) ||
          t.isFunctionExpression(decl) ||
          t.isCallExpression(decl)
        ) {
          componentDB.fileSetDefaultExport(fileName);
          return;
        }
      },

      FunctionDeclaration(nodePath) {
        const name = nodePath.node.id?.name;
        if (!name) return;

        if (isHook(name)) {
          const isExported =
            nodePath.parentPath.isExportNamedDeclaration() ||
            nodePath.parentPath.isExportDefaultDeclaration();

          if (!isExported) return;

          componentDB.addHook({
            name,
            file: fileName,
            states: [],
            props: [],
          });
        }

        if (containsJSX(nodePath)) {
          componentDB.addComponent({
            name,
            file: fileName,
            type: "Function",
            states: [],
            hooks: [],
            props: [],
            contexts: [],
            renders: [],
          });
        }
      },

      VariableDeclarator(nodePath) {
        const id = nodePath.node.id;
        const init = nodePath.node.init;

        if (
          t.isCallExpression(init) &&
          t.isIdentifier(init.callee) &&
          init.callee.name === "useState"
        ) {
          const id = nodePath.node.id;

          if (t.isArrayPattern(id)) {
            const [stateVar, setterVar] = id.elements;

            let state: State | null = null;
            if (t.isIdentifier(stateVar)) {
              state = { value: stateVar.name };
            }
            if (t.isIdentifier(setterVar)) {
              assert(state != null, "useState have setter without value");
              state!.setter = setterVar.name;
            }

            if (state != null) {
              const name = getVariableComponentName(nodePath);

              if (name) {
                componentDB.comAddState(name, fileName, state);
              }
            }
          }
        }

        if (id.type !== "Identifier") return;

        const name = id.name;

        if (
          !init ||
          (init.type !== "ArrowFunctionExpression" &&
            init.type !== "FunctionExpression")
        )
          return;

        if (containsJSX(nodePath)) {
          componentDB.addComponent({
            name,
            file: fileName,
            type: "Function",
            states: [],
            hooks: [],
            props: [],
            contexts: [],
            renders: [],
          });
        }
      },

      JSXElement(nodePath) {
        const opening = nodePath.node.openingElement.name;
        if (opening.type === "JSXIdentifier") {
          const tag = opening.name;
          const parentFunc = nodePath.getFunctionParent();

          let compName = null;

          if (parentFunc?.node.type === "FunctionDeclaration") {
            // function MyComponent() {}
            compName = parentFunc.node.id?.name;
          } else if (
            parentFunc?.node.type === "ArrowFunctionExpression" ||
            parentFunc?.node.type === "FunctionExpression"
          ) {
            // const MyComponent = () => {}
            const parent = parentFunc.parentPath?.node;
            if (parent?.type === "VariableDeclarator") {
              const id = parent.id;

              if (id.type === "Identifier") {
                compName = id.name;
              }
            }
          } else {
            compName = parentFunc?.node.type;
          }

          if (compName == null) {
            return;
          }

          // TODO: handle ObjectMethod
          if (compName == "ObjectMethod") {
            return;
          }

          // const key = getComponentKey(compName, file);
          // let id = componentIds.get(key);

          // if (id == null) {
          //   id = crypto.randomUUID();
          //   componentIds.set(key, id);
          // }

          if (/^[A-Z]/.test(tag)) {
            componentDB.comAddRender(compName, fileName, tag);
            // components[id].renders.push(tag);
            // edges.push({
            //   from: id,
            //   to: tag,
            //   label: "renders",
            // });
          }
        }
      },

      CallExpression(nodePath) {
        const callee = nodePath.node.callee;
        if (callee.type !== "Identifier") return;
        // console.log(path.node);

        const fn = callee.name;
        const parentFunc = nodePath.getFunctionParent();
        let compName: string | undefined;
        if (parentFunc?.node.type === "FunctionDeclaration") {
          compName = parentFunc.node.id?.name;
        } else if (
          parentFunc?.node.type === "ArrowFunctionExpression" ||
          parentFunc?.node.type === "FunctionExpression"
        ) {
          const bindingPath = parentFunc.parentPath;
          if (bindingPath.isVariableDeclarator()) {
            if (bindingPath.node.id.type === "Identifier") {
              compName = bindingPath.node.id.name;
            }
          } else if (bindingPath.isAssignmentExpression()) {
            if (bindingPath.node.left.type === "Identifier") {
              compName = bindingPath.node.left.name;
            }
          }
        }

        // if (!compName || !components[compName]) return;

        // if (fn === "useState" || fn === "useReducer") {
        //   components[compName].states.push(fn);
        // }

        // if (fn === "useContext") {
        //   components[compName].contexts.push(fn);
        // }

        if (compName && isHook(fn) && fn === "useWindowDimensions") {
          componentDB.comAddHook(compName, fileName, fn);
        }
      },
    });
  }

  componentDB.resolve();

  return componentDB.getData();
}

function main() {
  const packageJson = new PackageJson(SRC_DIR);

  const viteConfigPath = getViteConfig(SRC_DIR);
  console.log("viteConfigPath", viteConfigPath);
  const files = getFiles(SRC_DIR);
  // fs.writeFileSync("./out/files.json", JSON.stringify(files));
  console.log(`Analyzing ${files.length} files...`);
  const graph = analyzeFiles(viteConfigPath, files, packageJson);

  fs.mkdirSync(path.dirname(PUBLIC_FILE), { recursive: true });
  fs.writeFileSync(PUBLIC_FILE, JSON.stringify(graph, null, 2));
  console.log(`Graph written to ${PUBLIC_FILE}`);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(graph, null, 2));
  console.log(`Graph written to ${OUT_FILE}`);
}

main();
