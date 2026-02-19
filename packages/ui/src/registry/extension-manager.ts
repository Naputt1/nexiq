import type { Extension } from "@react-map/extension-sdk";
import { registerDetailSection } from "./detail-sections";
import { allExtensions } from "../views/tasks/all-tasks";

const extensions: Map<string, Extension> = new Map();

/**
 * Loads and registers an extension's UI components.
 */
export function loadExtension(extension: Extension) {
  if (extensions.has(extension.id)) return;
  extensions.set(extension.id, extension);

  // Register detail sections
  if (extension.detailSections) {
    for (const section of extension.detailSections) {
      registerDetailSection(section);
    }
  }
}

// Automatically load UI parts of all extensions
for (const ext of allExtensions) {
  loadExtension(ext);
}

/**
 * Returns all loaded extensions.
 */
export function getExtensions(): Extension[] {
  return Array.from(extensions.values());
}
