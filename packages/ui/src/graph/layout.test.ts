import { describe, it, expect } from "vitest";
import { ForceLayout, type Node, type Edge } from "./layout";

describe("ForceLayout", () => {
  it("should converge to a stable state without exploding", async () => {
    const nodes: Node[] = [
      { id: "n1", x: 0, y: 0, radius: 20 },
      { id: "n2", x: 10, y: 10, radius: 20 },
      { id: "n3", x: -10, y: -10, radius: 20 },
    ];
    const edges: Edge[] = [
      { source: "n1", target: "n2" },
      { source: "n2", target: "n3" },
      { source: "n3", target: "n1" },
    ];

    const layout = new ForceLayout(nodes, edges, {
      repulsionStrength: 1000,
      linkDistance: 80,
      gravity: 0.5,
      alphaDecay: 0.02,
    });

    await layout.runSteps(500);

    const positions = layout.getPositions();

    for (const pos of positions) {
      // Check for NaN
      expect(pos.x).not.toBeNaN();
      expect(pos.y).not.toBeNaN();

      // Check for extreme positions (should stay relatively near origin if gravity is at default 0.1)
      expect(Math.abs(pos.x)).toBeLessThan(500);
      expect(Math.abs(pos.y)).toBeLessThan(500);
    }
  });

  it("should apply maxDisplacement when forces are extreme", async () => {
    const nodes: Node[] = [
      { id: "n1", x: 0, y: 0, radius: 20 },
      { id: "n2", x: 0.0001, y: 0, radius: 20 }, // Extremely close
    ];
    const edges: Edge[] = [];

    const layout = new ForceLayout(nodes, edges, {
      repulsionStrength: 1000000, // Insane repulsion
      maxDisplacement: 50,
      timeStep: 1,
    });

    await layout.runSteps(1);

    const positions = layout.getPositions();

    // Total displacement between n0 and n1 should be capped
    // n0 moves left, n1 moves right. Each should move at most 50.
    expect(Math.abs(positions[0].x)).toBeLessThanOrEqual(51); // 50 + epsilon
    expect(Math.abs(positions[1].x)).toBeLessThanOrEqual(51);
  });
});
