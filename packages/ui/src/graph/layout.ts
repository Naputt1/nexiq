// force-layout.ts
export type Node = {
  id: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  mass?: number;
  radius?: number;
  fixed?: boolean;
  // any additional data you want to carry
  [key: string]: unknown;
};

export type Edge = {
  source: string; // node id
  target: string; // node id
  distance?: number; // preferred length
  strength?: number; // spring stiffness
  [key: string]: unknown;
};

export type ForceOptions = {
  // physics params
  attractionStrength?: number; // multiplier for springs (default 0.1)
  repulsionStrength?: number; // multiplier for node repulsion (default 300)
  linkDistance?: number; // default preferred distance (default 80)
  minNodeDistance?: number; // minimum distance between nodes to avoid overlap (default 0 - disabled)
  nodeRadius?: number; // default radius for nodes if not specified on node (default 0)
  collisionStrength?: number; // multiplier for collision force (default 0.5)
  damping?: number; // velocity damping [0..1) (default 0.9)
  gravity?: number; // pulls nodes toward center (default 0.1)
  maxDisplacement?: number; // prevents exploding positions (default 100)
  timeStep?: number; // seconds per tick (default 0.016 ~ 60FPS)
  // integration
  useVerlet?: boolean; // currently we use explicit Euler by default
  // stop criteria
  alpha?: number; // simulation temperature (0..1). If provided, cools each tick by alpha *= (1 - decay)
  alphaDecay?: number; // fraction per tick to reduce alpha (default 0.02)
  // performance
  theta?: number; // for future Barnes-Hut extension; currently unused
};

type InternalNode = Node & {
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  mass: number;
  radius: number;
};

export class ForceLayout {
  nodes: InternalNode[];
  edges: Edge[];
  lookup: Map<string, InternalNode>;
  opts: Required<ForceOptions>;

  // callback invoked after each step with current nodes positions
  onTick?: (nodes: Node[], stepCount: number) => Promise<void>;

  private stepCount = 0;
  private running = false;
  private rafId: number | null = null;

  constructor(nodes: Node[], edges: Edge[], options?: ForceOptions) {
    this.opts = {
      attractionStrength: 0.1,
      repulsionStrength: 300,
      linkDistance: 80,
      minNodeDistance: 0,
      nodeRadius: 0,
      collisionStrength: 0.5,
      damping: 0.9,
      gravity: 0.1,
      maxDisplacement: 100,
      timeStep: 0.016,
      useVerlet: false,
      alpha: 1.0,
      alphaDecay: 0.02,
      theta: 0.5,
      ...(options || {}),
    };

    // initialize internal node state
    this.nodes = nodes.map((n) => ({
      ...n,
      vx: n.vx ?? 0,
      vy: n.vy ?? 0,
      fx: 0,
      fy: 0,
      mass: n.mass ?? 1,
      radius: n.radius ?? this.opts.nodeRadius,
    }));

    this.edges = edges.map((e) => ({
      distance: this.opts.linkDistance,
      strength: this.opts.attractionStrength,
      ...e,
    }));

    this.lookup = new Map();
    for (const n of this.nodes) this.lookup.set(n.id, n);
  }

  // single simulation step (deterministic)
  async step(): Promise<void> {
    const { nodes, edges, opts } = this;
    const n = nodes.length;
    this.stepCount++;

    // reset forces
    for (let i = 0; i < n; i++) {
      nodes[i].fx = 0;
      nodes[i].fy = 0;
    }

    // 1) repulsive forces (O(n^2))
    const repulseCoef = opts.repulsionStrength;
    const minNodeDist = opts.minNodeDistance;
    const collisionK = opts.collisionStrength;
    const alpha = opts.alpha ?? 1.0;

    for (let i = 0; i < n; i++) {
      const ni = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const nj = nodes[j];
        let dx = ni.x - nj.x;
        let dy = ni.y - nj.y;
        let dist2 = dx * dx + dy * dy;

        if (dist2 === 0) {
          dx = Math.random() * 0.1 - 0.05;
          dy = Math.random() * 0.1 - 0.05;
          dist2 = dx * dx + dy * dy;
        }

        const dist = Math.sqrt(dist2);
        const ux = dx / dist;
        const uy = dy / dist;

        // Repulsion: inverse-linear distance (Better for long-range convergence)
        let force = (repulseCoef * ni.mass * nj.mass) / (dist + 1);

        // Collision / Minimum distance
        const effectiveMinDist = minNodeDist + ni.radius + nj.radius;
        if (effectiveMinDist > 0 && dist < effectiveMinDist) {
          const overlap = effectiveMinDist - dist;
          force += collisionK * overlap * 100;
        }

        const fx = ux * force * alpha;
        const fy = uy * force * alpha;

        ni.fx += fx;
        ni.fy += fy;
        nj.fx -= fx;
        nj.fy -= fy;
      }
    }

    // 2) attractive forces (Hooke's law)
    for (const e of edges) {
      const a = this.lookup.get(e.source);
      const b = this.lookup.get(e.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1e-6;
      const desired = e.distance ?? opts.linkDistance;
      const strength = e.strength ?? opts.attractionStrength;

      const f = strength * (dist - desired) * alpha;

      const ux = dx / dist;
      const uy = dy / dist;

      const fx = ux * f;
      const fy = uy * f;

      a.fx += fx;
      a.fy += fy;
      b.fx -= fx;
      b.fy -= fy;
    }

    // 3) central gravity
    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      // Use alpha to cool gravity as well
      const g = opts.gravity * alpha;
      node.fx -= node.x * g * node.mass;
      node.fy -= node.y * g * node.mass;
    }

    // 4) integrate
    const dt = opts.timeStep;
    for (let i = 0; i < n; i++) {
      const node = nodes[i];
      if (node.fixed) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      const ax = node.fx / node.mass;
      const ay = node.fy / node.mass;

      node.vx += ax * dt;
      node.vy += ay * dt;

      node.vx *= opts.damping;
      node.vy *= opts.damping;

      let dx = node.vx * dt;
      let dy = node.vy * dt;

      const disp = Math.sqrt(dx * dx + dy * dy);
      if (disp > opts.maxDisplacement) {
        const scale = opts.maxDisplacement / disp;
        dx *= scale;
        dy *= scale;
        node.vx = dx / dt;
        node.vy = dy / dt;
      }

      node.x += dx;
      node.y += dy;
    }

    // cool alpha
    if (opts.alpha !== undefined) {
      opts.alpha *= 1 - opts.alphaDecay;
    }

    // call tick callback with shallow-copied nodes (strip internals)
    if (this.onTick) {
      await this.onTick(
        nodes.map(({ id, x, y, ...rest }) => ({ id, x, y, ...rest })) as Node[],
        this.stepCount,
      );
    }
  }

  // run continuously (uses requestAnimationFrame if available)
  // This method does not start automatically; call it explicitly when you want the simulation to run.
  start(maxSteps = Infinity): void {
    if (this.running) return;
    this.running = true;
    let steps = 0;
    const loop = () => {
      if (!this.running || steps >= maxSteps) {
        this.running = false;
        if (this.rafId != null) {
          cancelAnimationFrame(this.rafId);
          this.rafId = null;
        }
        return;
      }
      this.step();
      steps++;
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  // run a fixed number of synchronous steps (useful for testing or node)
  async runSteps(count: number): Promise<void> {
    for (let i = 0; i < count; i++) await this.step();
  }

  // convenience: get public node positions
  getPositions(): { id: string; x: number; y: number }[] {
    return this.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y }));
  }
}
