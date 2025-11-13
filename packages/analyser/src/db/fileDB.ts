import assert from "assert";
import type { ComponentFile, ComponentFileImport } from "../types.js";

export class FileDB {
  private files: Map<string, ComponentFile>;

  constructor() {
    this.files = new Map();
  }

  public add(filename: string) {
    this.files.set(filename, {
      path: filename,
      import: {},
    });
  }

  public addImport(fileName: string, fileImport: ComponentFileImport) {
    const file = this.files.get(fileName);
    assert(file != null, "File not found");
    assert(file.import[fileImport.localName] == null, "Import already exists");

    file.import[fileImport.localName] = {
      localName: fileImport.localName,
      importedName: fileImport.importedName,
      source: fileImport.source,
      type: fileImport.type,
      importKind: fileImport.importKind,
    };
  }

  public get(fileName: string) {
    const file = this.files.get(fileName);
    assert(file != null, "File not found");
    return file;
  }

  public getImport(fileName: string, localName: string) {
    const file = this.get(fileName);
    return file.import[localName];
  }

  public getData() {
    return Object.fromEntries(this.files);
  }
}
