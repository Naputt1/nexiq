# React Map Extensions Guide

Extensions allow you to add custom graph tasks, UI sections, and MCP tools to `react-map`.

## Creating an Extension

1. Create a new package depending on `@react-map/extension-sdk` and `@react-map/shared`.
2. Define an `Extension` object:

```typescript
import { Extension } from "@react-map/extension-sdk";

const myExtension: Extension = {
  id: "my-custom-extension",
  mcpTools: [
    {
      name: "my_tool",
      description: "Does something cool",
      inputSchema: { type: "object", properties: { ... } },
      handler: async (args) => { ... }
    }
  ],
  viewTasks: {
    component: [ ... ]
  }
};

export default myExtension;
```

3. Build and publish your extension (e.g., to NPM or GitHub Packages).

## Installing an Extension

To use an extension in a project:

1. Install the extension in your target project:
   ```bash
   npm install @react-map/my-custom-extension
   ```

2. Add the extension to your `react.map.config.json` in the project root:
   ```json
   {
     "extensions": ["@react-map/my-custom-extension"]
   }
   ```

## Loading Extensions in the UI

The `react-map-ui` application can load bundled extensions. To add an extension to your local UI build:

1. Install it in the UI repository:
   ```bash
   pnpm add @react-map/my-custom-extension
   ```

2. Register it in `src/views/tasks/all-tasks.ts`:
   ```typescript
   import myExtension from "@react-map/my-custom-extension";

   export const allExtensions = [
     // ...
     myExtension
   ];
   ```

3. Rebuild the UI.

## Runtime Loading (Experimental)

The server automatically loads extensions from the project's `node_modules` to provide MCP tools. Future versions of the UI will support dynamic runtime loading of extension UI components via the WebSocket connection.
