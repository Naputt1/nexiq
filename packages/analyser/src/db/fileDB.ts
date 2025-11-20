import assert from "assert";
import type {
  ComponentFile,
  ComponentFileExport,
  ComponentFileImport,
} from "shared";

export class FileDB {
  private files: Map<string, ComponentFile>;

  constructor() {
    this.files = new Map();
  }

  public add(filename: string) {
    this.files.set(filename, {
      path: filename,
      import: {},
      export: {},
      defaultExport: null,
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

  public getComId(fileName: string, localName: string) {
    const file = this.get(fileName);

    if (file.export.hasOwnProperty(localName)) {
      return file.export[localName]?.id ?? crypto.randomUUID();
    }

    return crypto.randomUUID();
  }

  public getData() {
    return Object.fromEntries(this.files);
  }

  public addExport(fileName: string, exportData: ComponentFileExport) {
    const file = this.get(fileName);

    file.export[exportData.name] = exportData;
    if (exportData.type === "default") {
      file.defaultExport = exportData.name;
    }
  }

  public setDefaultExport(fileName: string, exportVal?: string | null) {
    const file = this.get(fileName);

    file.defaultExport = exportVal ?? "anonymous";
  }

  public getDefaultExport(fileName: string) {
    const file = this.get(fileName);
    return file.defaultExport;
  }
}
