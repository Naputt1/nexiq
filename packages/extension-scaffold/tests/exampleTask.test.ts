import { describe, it, expect } from "vitest";

describe("exampleExtension", () => {
  it("should be importable", async () => {
    const mod = await import("../src/index.js");
    expect(mod.exampleExtension).toBeDefined();
    expect(mod.exampleExtension.id).toBe("example-extension");
  });
});
