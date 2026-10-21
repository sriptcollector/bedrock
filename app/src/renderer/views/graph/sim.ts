// Force-directed layout for the graph view: center (x/y pull to the origin), link springs, many-body
// repulsion (Barnes-Hut quadtree) and collision, integrated with velocity decay like a d3-force
// simulation. Everything lives in typed arrays so 10k nodes / 160k links tick in a few ms.
//
// `createSimulation` must stay self-contained (no imports, no outer references): its source text is
// also used as the body of the layout Web Worker (see `simulationWorkerUrl`).

export interface SimForces {
  /** pull towards the centre (already mapped from the slider) */
  center: number;
  /** many-body strength (positive = repel); the slider value cubed */
  repel: number;
  /** link spring strength multiplier (mapped from the slider) */
  link: number;
  /** rest length of a link */
  distance: number;
}

export interface Simulation {
  n: number;
  x: Float32Array;
  y: Float32Array;
  alpha: number;
  alphaTarget: number;
  alphaMin: number;
  setGraph(n: number, pos: Float32Array, links: Uint32Array): void;
  setForces(f: Partial<SimForces>): void;
  fix(i: number, x: number | null, y: number | null): void;
  tick(): void;
  running(): boolean;
}

export function createSimulation(): Simulation {
  const ALPHA_DECAY = 1 - Math.pow(0.001, 1 / 300);
  const VELOCITY_KEEP = 0.6;
  const THETA2 = 0.81;
  const DIST_MIN2 = 900;
  const COLLIDE_R = 60;
  const COLLIDE_STRENGTH = 0.5;

  let n = 0;
  let x = new Float32Array(0);
  let y = new Float32Array(0);
  let vx = new Float64Array(0);
  let vy = new Float64Array(0);
  let fx = new Float64Array(0); // NaN = free
  let fy = new Float64Array(0);
  let linkSrc = new Uint32Array(0);
  let linkDst = new Uint32Array(0);
  let linkBias = new Float32Array(0);
  let linkStr = new Float32Array(0);
  const forces: SimForces = { center: 0.1, repel: 1000, link: 1, distance: 250 };

  // quadtree pools
  let cap = 0;
  let qChild = new Int32Array(0); // 4 per cell, -1 empty, >=0 cell index, <= -2 leaf: -(node+2)
  let qMass = new Float64Array(0);
  let qX = new Float64Array(0);
  let qY = new Float64Array(0);
  let qSize = new Float64Array(0);
  let qNext = new Int32Array(0); // linked list of extra points sharing an exact position (per node)
  let cells = 0;

  function jiggle(): number {
    return (Math.random() - 0.5) * 1e-6;
  }

  function ensureCap(c: number): void {
    if (c <= cap) return;
    cap = Math.max(c, cap * 2, 64);
    const ch = new Int32Array(cap * 4);
    ch.set(qChild);
    qChild = ch;
    const grow = (a: Float64Array) => {
      const b = new Float64Array(cap);
      b.set(a);
      return b;
    };
    qMass = grow(qMass);
    qX = grow(qX);
    qY = grow(qY);
    qSize = grow(qSize);
  }

  function newCell(size: number): number {
    ensureCap(cells + 1);
    const c = cells++;
    qChild[c * 4] = qChild[c * 4 + 1] = qChild[c * 4 + 2] = qChild[c * 4 + 3] = -1;
    qMass[c] = 0;
    qX[c] = 0;
    qY[c] = 0;
    qSize[c] = size;
    return c;
  }

  let rootX0 = 0, rootY0 = 0, rootSize = 1;

  function buildTree(): void {
    cells = 0;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const a = x[i], b = y[i];
      if (a < x0) x0 = a;
      if (a > x1) x1 = a;
      if (b < y0) y0 = b;
      if (b > y1) y1 = b;
    }
    if (!(x1 >= x0)) {
      x0 = y0 = 0;
      x1 = y1 = 1;
    }
    const size = Math.max(x1 - x0, y1 - y0, 1) * 1.0001 + 1;
    rootX0 = x0;
    rootY0 = y0;
    rootSize = size;
    ensureCap(n * 2 + 8);
    if (qNext.length < n) qNext = new Int32Array(Math.max(n, 16));
    const root = newCell(size);
    for (let i = 0; i < n; i++) {
      qNext[i] = -1;
      insert(root, x0, y0, size, i, 0);
    }
    accumulate(root);
  }

  function insert(cell: number, cx: number, cy: number, size: number, i: number, depth: number): void {
    for (;;) {
      const half = size / 2;
      const right = x[i] >= cx + half ? 1 : 0;
      const bottom = y[i] >= cy + half ? 1 : 0;
      const q = bottom * 2 + right;
      const slot = cell * 4 + q;
      const ch = qChild[slot];
      const ncx = cx + right * half;
      const ncy = cy + bottom * half;
      if (ch === -1) {
        qChild[slot] = -(i + 2);
        return;
      }
      if (ch >= 0) {
        cell = ch;
        cx = ncx;
        cy = ncy;
        size = half;
        depth++;
        continue;
      }
      // occupied by a leaf point
      const j = -ch - 2;
      if ((x[j] === x[i] && y[j] === y[i]) || depth > 48) {
        // coincident: chain it
        qNext[i] = qNext[j];
        qNext[j] = i;
        return;
      }
      const sub = newCell(half);
      qChild[slot] = sub;
      // re-insert j into the new cell, then continue inserting i
      insertLeaf(sub, ncx, ncy, half, j);
      cell = sub;
      cx = ncx;
      cy = ncy;
      size = half;
      depth++;
    }
  }

  function insertLeaf(cell: number, cx: number, cy: number, size: number, j: number): void {
    const half = size / 2;
    const right = x[j] >= cx + half ? 1 : 0;
    const bottom = y[j] >= cy + half ? 1 : 0;
    qChild[cell * 4 + bottom * 2 + right] = -(j + 2);
  }

  // charge per node is uniform (-repel), so mass = count and centre = mean position
  function accumulate(cell: number): void {
    let m = 0, sx = 0, sy = 0;
    for (let q = 0; q < 4; q++) {
      const ch = qChild[cell * 4 + q];
      if (ch === -1) continue;
      if (ch >= 0) {
        accumulate(ch);
        const cm = qMass[ch];
        m += cm;
        sx += qX[ch] * cm;
        sy += qY[ch] * cm;
      } else {
        for (let p = -ch - 2; p !== -1; p = qNext[p]) {
          m += 1;
          sx += x[p];
          sy += y[p];
        }
      }
    }
    qMass[cell] = m;
    qX[cell] = m ? sx / m : 0;
    qY[cell] = m ? sy / m : 0;
  }

  const stack = new Int32Array(4096);

  function applyCharge(alpha: number): void {
    const strength = -(Math.abs(forces.repel) < 1 ? 1 : forces.repel);
    if (n < 2) return;
    buildTree();
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i];
      let ax = 0, ay = 0;
      let sp = 0;
      stack[sp++] = 0;
      while (sp > 0) {
        const cell = stack[--sp];
        const m = qMass[cell];
        if (!m) continue;
        let dx = qX[cell] - xi;
        let dy = qY[cell] - yi;
        let l = dx * dx + dy * dy;
        const w = qSize[cell];
        if ((w * w) / THETA2 < l) {
          if (l < DIST_MIN2) l = Math.sqrt(DIST_MIN2 * l);
          ax += (dx * strength * m) / l;
          ay += (dy * strength * m) / l;
          continue;
        }
        for (let q = 0; q < 4; q++) {
          const ch = qChild[cell * 4 + q];
          if (ch === -1) continue;
          if (ch >= 0) {
            if (sp < stack.length) stack[sp++] = ch;
            continue;
          }
          for (let p = -ch - 2; p !== -1; p = qNext[p]) {
            if (p === i) continue;
            dx = x[p] - xi;
            dy = y[p] - yi;
            l = dx * dx + dy * dy;
            if (dx === 0) {
              dx = jiggle();
              l += dx * dx;
            }
            if (dy === 0) {
              dy = jiggle();
              l += dy * dy;
            }
            if (l < DIST_MIN2) l = Math.sqrt(DIST_MIN2 * l);
            ax += (dx * strength) / l;
            ay += (dy * strength) / l;
          }
        }
      }
      vx[i] += ax * alpha;
      vy[i] += ay * alpha;
    }
  }

  // collision on a uniform grid (all radii are equal)
  let gridHead = new Int32Array(0);
  let gridNext = new Int32Array(0);
  function applyCollide(): void {
    if (n < 2) return;
    const r = COLLIDE_R;
    const cell = 2 * r;
    const cols = Math.min(1024, Math.max(1, Math.ceil(rootSize / cell) + 1));
    const total = cols * cols;
    if (gridHead.length < total) gridHead = new Int32Array(total);
    gridHead.fill(-1, 0, total);
    if (gridNext.length < n) gridNext = new Int32Array(n);
    const cs = Math.max(cell, rootSize / (cols - 1 || 1));
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      px[i] = x[i] + vx[i];
      py[i] = y[i] + vy[i];
      let gx = Math.floor((px[i] - rootX0) / cs);
      let gy = Math.floor((py[i] - rootY0) / cs);
      gx = gx < 0 ? 0 : gx >= cols ? cols - 1 : gx;
      gy = gy < 0 ? 0 : gy >= cols ? cols - 1 : gy;
      const k = gy * cols + gx;
      gridNext[i] = gridHead[k];
      gridHead[k] = i;
    }
    const rr = (r + r) * (r + r);
    for (let i = 0; i < n; i++) {
      let gx = Math.floor((px[i] - rootX0) / cs);
      let gy = Math.floor((py[i] - rootY0) / cs);
      gx = gx < 0 ? 0 : gx >= cols ? cols - 1 : gx;
      gy = gy < 0 ? 0 : gy >= cols ? cols - 1 : gy;
      for (let oy = -1; oy <= 1; oy++) {
        const yy = gy + oy;
        if (yy < 0 || yy >= cols) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const xx = gx + ox;
          if (xx < 0 || xx >= cols) continue;
          for (let j = gridHead[yy * cols + xx]; j !== -1; j = gridNext[j]) {
            if (j <= i) continue;
            let dx = px[i] - x[j] - vx[j];
            let dy = py[i] - y[j] - vy[j];
            let l = dx * dx + dy * dy;
            if (l >= rr) continue;
            if (dx === 0) {
              dx = jiggle();
              l += dx * dx;
            }
            if (dy === 0) {
              dy = jiggle();
              l += dy * dy;
            }
            const d = Math.sqrt(l);
            const k = (((r + r) - d) / d) * COLLIDE_STRENGTH * 0.5;
            vx[i] += dx * k;
            vy[i] += dy * k;
            vx[j] -= dx * k;
            vy[j] -= dy * k;
          }
        }
      }
    }
  }

  function applyLinks(alpha: number): void {
    const dist = forces.distance;
    const str = forces.link;
    for (let k = 0; k < linkSrc.length; k++) {
      const s = linkSrc[k], t = linkDst[k];
      let dx = x[t] + vx[t] - x[s] - vx[s];
      let dy = y[t] + vy[t] - y[s] - vy[s];
      if (dx === 0) dx = jiggle();
      if (dy === 0) dy = jiggle();
      let l = Math.sqrt(dx * dx + dy * dy);
      l = ((l - dist) / l) * alpha * str * linkStr[k];
      dx *= l;
      dy *= l;
      const b = linkBias[k];
      vx[t] -= dx * b;
      vy[t] -= dy * b;
      vx[s] += dx * (1 - b);
      vy[s] += dy * (1 - b);
    }
  }

  function applyCenter(alpha: number): void {
    const s = forces.center * alpha;
    for (let i = 0; i < n; i++) {
      vx[i] -= x[i] * s;
      vy[i] -= y[i] * s;
    }
  }

  const sim: Simulation = {
    n: 0,
    x,
    y,
    alpha: 1,
    alphaTarget: 0,
    alphaMin: 0.001,
    setGraph(count: number, pos: Float32Array, links: Uint32Array) {
      n = count;
      const nx = new Float32Array(n), ny = new Float32Array(n);
      const nvx = new Float64Array(n), nvy = new Float64Array(n);
      const nfx = new Float64Array(n).fill(NaN), nfy = new Float64Array(n).fill(NaN);
      for (let i = 0; i < n; i++) {
        let a = pos[i * 2], b = pos[i * 2 + 1];
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
          const ang = i * Math.PI * (3 - Math.sqrt(5));
          const rad = 10 * Math.sqrt(0.5 + i);
          a = rad * Math.cos(ang);
          b = rad * Math.sin(ang);
        }
        nx[i] = a;
        ny[i] = b;
      }
      x = nx;
      y = ny;
      vx = nvx;
      vy = nvy;
      fx = nfx;
      fy = nfy;
      sim.x = x;
      sim.y = y;
      sim.n = n;
      const m = links.length >> 1;
      linkSrc = new Uint32Array(m);
      linkDst = new Uint32Array(m);
      const deg = new Float32Array(n);
      for (let k = 0; k < m; k++) {
        linkSrc[k] = links[k * 2];
        linkDst[k] = links[k * 2 + 1];
        deg[linkSrc[k]]++;
        deg[linkDst[k]]++;
      }
      linkBias = new Float32Array(m);
      linkStr = new Float32Array(m);
      for (let k = 0; k < m; k++) {
        const cs = deg[linkSrc[k]], ct = deg[linkDst[k]];
        linkBias[k] = cs / (cs + ct);
        linkStr[k] = 1 / Math.min(cs, ct);
      }
    },
    setForces(f: Partial<SimForces>) {
      if (typeof f.center === "number") forces.center = f.center;
      if (typeof f.repel === "number") forces.repel = f.repel;
      if (typeof f.link === "number") forces.link = f.link;
      if (typeof f.distance === "number") forces.distance = f.distance;
    },
    fix(i: number, px: number | null, py: number | null) {
      if (i < 0 || i >= n) return;
      fx[i] = px === null ? NaN : px;
      fy[i] = py === null ? NaN : py;
    },
    tick() {
      sim.alpha += (sim.alphaTarget - sim.alpha) * ALPHA_DECAY;
      const alpha = sim.alpha;
      applyCenter(alpha);
      applyLinks(alpha);
      applyCharge(alpha);
      applyCollide();
      for (let i = 0; i < n; i++) {
        if (fx[i] === fx[i]) {
          x[i] = fx[i];
          vx[i] = 0;
        } else {
          vx[i] *= VELOCITY_KEEP;
          x[i] += vx[i];
        }
        if (fy[i] === fy[i]) {
          y[i] = fy[i];
          vy[i] = 0;
        } else {
          vy[i] *= VELOCITY_KEEP;
          y[i] += vy[i];
        }
      }
    },
    running() {
      return sim.alpha >= sim.alphaMin || sim.alphaTarget > 0;
    },
  };
  return sim;
}

/** Worker glue around createSimulation: receives graph/forces/drag messages, posts positions. */
function workerMain(make: () => Simulation): void {
  const ctx: any = self;
  const sim = make();
  let timer: any = null;
  const post = () => {
    const buf = new Float32Array(sim.n * 2);
    for (let i = 0; i < sim.n; i++) {
      buf[i * 2] = sim.x[i];
      buf[i * 2 + 1] = sim.y[i];
    }
    ctx.postMessage({ type: "tick", positions: buf, alpha: sim.alpha, running: sim.running() }, [buf.buffer]);
  };
  const loop = () => {
    timer = null;
    if (!sim.running()) {
      post();
      return;
    }
    const t0 = performance.now();
    sim.tick();
    post();
    const spent = performance.now() - t0;
    timer = setTimeout(loop, Math.max(0, 1000 / 60 - spent));
  };
  const run = () => {
    if (timer === null) timer = setTimeout(loop, 0);
  };
  ctx.onmessage = (e: MessageEvent) => {
    const m = e.data;
    if (m.type === "graph") {
      sim.setGraph(m.n, m.positions, m.links);
      if (typeof m.alpha === "number") sim.alpha = m.alpha;
    } else if (m.type === "forces") sim.setForces(m.forces);
    else if (m.type === "fix") sim.fix(m.index, m.x, m.y);
    else if (m.type === "stop") {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      return;
    }
    if (typeof m.alpha === "number" && m.type !== "graph") sim.alpha = Math.max(sim.alpha, m.alpha);
    if (typeof m.alphaTarget === "number") sim.alphaTarget = m.alphaTarget;
    if (m.run) run();
  };
}

let workerUrl: string | null = null;

/** A blob URL for the layout worker (built from the functions above, so no extra bundle file). */
export function simulationWorkerUrl(): string {
  if (!workerUrl) {
    const src = `"use strict";\n(${workerMain.toString()})(${createSimulation.toString()});`;
    workerUrl = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  }
  return workerUrl;
}
