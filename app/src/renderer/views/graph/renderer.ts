// Graph renderer: WebGL2 for links, arrows and nodes (instanced, positions streamed through a float
// texture so 10k nodes / 160k links redraw in well under a frame), a 2D canvas on top for labels and
// the hover ring. The force layout runs in a Web Worker (sim.ts). Colours come from CSS classes
// (`.graph-view.color-fill`, `.color-line`, ...) that map to the --graph-* variables, so themes apply.
import { createSimulation, simulationWorkerUrl, type SimForces, type Simulation } from "./sim";
import { flatten, nodeDisplayText, nodeSize, type FlatGraph, type GraphData, type NodeType } from "./data";
import type { GraphColor } from "./options";

const FADE = 0.2;
const TEX_W = 2048;

export interface RendererHooks {
  onNodeClick?(e: MouseEvent, id: string, type: NodeType): void;
  onNodeRightClick?(e: MouseEvent, id: string, type: NodeType): void;
  onNodeHover?(e: MouseEvent, id: string, type: NodeType): void;
  onNodeUnhover?(): void;
}

const COLOR_CLASSES: Record<string, string> = {
  fill: "color-fill",
  fillFocused: "color-fill-focused",
  fillTag: "color-fill-tag",
  fillUnresolved: "color-fill-unresolved",
  fillAttachment: "color-fill-attachment",
  arrow: "color-arrow",
  circle: "color-circle",
  line: "color-line",
  text: "color-text",
  fillHighlight: "color-fill-highlight",
  lineHighlight: "color-line-highlight",
};

type Colors = Record<keyof typeof COLOR_CLASSES, GraphColor>;

function lerp(a: number, b: number, k = 0.9): number {
  return a * k + b * (1 - k);
}

/** Any CSS colour string -> {rgb, a} by letting a 1x1 canvas resolve it. */
let probeCtx: CanvasRenderingContext2D | null = null;
export function parseCssColor(str: string, opacity = 1): GraphColor {
  if (!probeCtx) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    probeCtx = c.getContext("2d", { willReadFrequently: true });
  }
  const ctx = probeCtx!;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = "#000";
  ctx.fillStyle = str;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  const a = d[3] / 255;
  if (a === 0) return { a: 0, rgb: 0x888888 };
  // un-premultiply is done by getImageData already (it returns straight alpha)
  return { a: a * opacity, rgb: (d[0] << 16) | (d[1] << 8) | d[2] };
}

// ---------- WebGL helpers ----------
const NODE_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_color;
uniform sampler2D u_nodes;
uniform vec3 u_view;
uniform vec2 u_res;
uniform float u_nodeScale;
out vec2 v_uv;
out vec4 v_color;
out float v_r;
void main() {
  int i = gl_InstanceID;
  vec4 d = texelFetch(u_nodes, ivec2(i % ${TEX_W}, i / ${TEX_W}), 0);
  float r = d.z * u_nodeScale * u_view.x;
  float rr = r + 1.5;
  vec2 s = d.xy * u_view.x + u_view.yz + a_corner * rr;
  gl_Position = vec4(s.x / u_res.x * 2.0 - 1.0, 1.0 - s.y / u_res.y * 2.0, 0.0, 1.0);
  v_uv = a_corner * rr;
  v_r = r;
  v_color = vec4(a_color.rgb, a_color.a * d.w);
}`;
const NODE_FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
in vec4 v_color;
in float v_r;
out vec4 o;
void main() {
  float a = clamp(v_r - length(v_uv) + 0.5, 0.0, 1.0) * v_color.a;
  if (a <= 0.0) discard;
  o = vec4(v_color.rgb * a, a);
}`;
const LINK_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in uvec2 a_link;
uniform sampler2D u_nodes;
uniform vec3 u_view;
uniform vec2 u_res;
uniform float u_nodeScale;
uniform float u_width;
uniform int u_hl;
uniform float u_fade;
uniform vec4 u_color;
uniform vec4 u_hlColor;
out vec4 v_color;
vec4 node(uint i) { int k = int(i); return texelFetch(u_nodes, ivec2(k % ${TEX_W}, k / ${TEX_W}), 0); }
void main() {
  vec4 s = node(a_link.x);
  vec4 t = node(a_link.y);
  vec2 ps = s.xy * u_view.x + u_view.yz;
  vec2 pt = t.xy * u_view.x + u_view.yz;
  vec2 dir = pt - ps;
  float len = length(dir);
  vec2 n = len > 0.0 ? dir / len : vec2(1.0, 0.0);
  float rs = s.z * u_nodeScale * u_view.x;
  float rt = t.z * u_nodeScale * u_view.x;
  vec2 a = ps + n * rs;
  vec2 b = len > rs + rt ? pt - n * rt : a;
  float w = max(u_width, 1.0);
  vec2 p = mix(a, b, a_corner.x) + vec2(-n.y, n.x) * a_corner.y * w;
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
  bool conn = u_hl >= 0 && (int(a_link.x) == u_hl || int(a_link.y) == u_hl);
  vec4 c = conn ? u_hlColor : u_color;
  float alpha = conn ? 1.0 : u_fade;
  v_color = vec4(c.rgb, c.a * alpha * min(u_width, 1.0));
}`;
const FLAT_FS = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 o;
void main() { o = vec4(v_color.rgb * v_color.a, v_color.a); }`;
const ARROW_VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in uvec2 a_link;
uniform sampler2D u_nodes;
uniform vec3 u_view;
uniform vec2 u_res;
uniform float u_nodeScale;
uniform float u_size;
uniform int u_hl;
uniform float u_fade;
uniform vec4 u_color;
out vec4 v_color;
vec4 node(uint i) { int k = int(i); return texelFetch(u_nodes, ivec2(k % ${TEX_W}, k / ${TEX_W}), 0); }
void main() {
  vec4 s = node(a_link.x);
  vec4 t = node(a_link.y);
  vec2 ps = s.xy * u_view.x + u_view.yz;
  vec2 pt = t.xy * u_view.x + u_view.yz;
  vec2 dir = pt - ps;
  float len = length(dir);
  vec2 n = len > 0.0 ? dir / len : vec2(1.0, 0.0);
  float rt = (t.z * u_nodeScale + 1.0) * u_view.x;
  vec2 tip = pt - n * rt;
  vec2 c = a_corner * u_size;
  vec2 p = tip + n * c.x + vec2(-n.y, n.x) * c.y;
  if (len <= rt) p = tip;
  gl_Position = vec4(p.x / u_res.x * 2.0 - 1.0, 1.0 - p.y / u_res.y * 2.0, 0.0, 1.0);
  bool conn = u_hl >= 0 && (int(a_link.x) == u_hl || int(a_link.y) == u_hl);
  v_color = vec4(u_color.rgb, u_color.a * (conn ? 1.0 : u_fade));
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link error");
  return p;
}

interface GL {
  gl: WebGL2RenderingContext;
  nodeProg: WebGLProgram;
  linkProg: WebGLProgram;
  arrowProg: WebGLProgram;
  tex: WebGLTexture;
  texH: number;
  nodeVao: WebGLVertexArrayObject;
  linkVao: WebGLVertexArrayObject;
  arrowVao: WebGLVertexArrayObject;
  colorBuf: WebGLBuffer;
  lineBuf: WebGLBuffer;
  arrowLinkBuf: WebGLBuffer;
  lineCount: number;
  arrowCount: number;
  u: Map<WebGLProgram, Record<string, WebGLUniformLocation | null>>;
}

export class GraphRenderer {
  containerEl: HTMLElement;
  canvasEl: HTMLCanvasElement;
  overlayEl: HTMLCanvasElement;
  hooks: RendererHooks = {};
  // data
  graph: FlatGraph = flatten({ nodes: {} });
  x = new Float32Array(0);
  y = new Float32Array(0);
  fadeAlpha = new Float32Array(0);
  textCache = new Map<string, { lines: string[]; w: number }>();
  // view
  width = 0;
  height = 0;
  scale = 1;
  targetScale = 1;
  panX = 0;
  panY = 0;
  panvX = 0;
  panvY = 0;
  zoomCenterX = 0;
  zoomCenterY = 0;
  nodeScale = 1;
  textAlpha = 1;
  keyboardActions: Record<string, boolean> = {};
  // render options
  fNodeSizeMult = 1;
  fLineSizeMult = 1;
  fTextShowMult = 0;
  fShowArrow = false;
  colors = {} as Colors;
  fontFamily = "sans-serif";
  // interaction
  highlight = -1;
  private lastHighlight = -1;
  private hoverFade = 1;
  private moveText = 0;
  dragNode = -1;
  private dragFx = 0;
  private dragFy = 0;
  private panning = false;
  // layout
  private worker: Worker | null = null;
  private inlineSim: Simulation | null = null;
  private inlineTimer: any = null;
  private glState: GL | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private overlayCtx: CanvasRenderingContext2D;
  private frame = 0;
  private idleFrames = 0;
  private destroyed = false;
  private resizeObs: ResizeObserver;
  private texData = new Float32Array(0);
  private colorData = new Float32Array(0);
  private colorsDirty = true;
  private forces: SimForces = { center: 0.1, repel: 1000, link: 1, distance: 250 };
  /** frames drawn (for FPS measurement) */
  frames = 0;
  lastFrameMs = 0;
  simTicks = 0;
  simAlpha = 1;
  simRunning = false;

  constructor(containerEl: HTMLElement) {
    this.containerEl = containerEl;
    this.canvasEl = containerEl.createEl("canvas");
    this.overlayEl = containerEl.createEl("canvas", { cls: "graph-labels" });
    this.overlayCtx = this.overlayEl.getContext("2d")!;
    this.initGL();
    this.initWorker();
    this.bindEvents();
    this.resizeObs = new ResizeObserver(() => this.onResize());
    this.resizeObs.observe(containerEl);
    this.testCSS();
    this.onResize();
    this.resetPan();
  }

  // ---------- setup ----------
  private initGL(): void {
    const gl = this.canvasEl.getContext("webgl2", { antialias: true, premultipliedAlpha: true, alpha: true }) as WebGL2RenderingContext | null;
    if (!gl) {
      this.ctx2d = this.canvasEl.getContext("2d");
      return;
    }
    try {
      const nodeProg = compile(gl, NODE_VS, NODE_FS);
      const linkProg = compile(gl, LINK_VS, FLAT_FS);
      const arrowProg = compile(gl, ARROW_VS, FLAT_FS);
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const quad = (data: number[]) => {
        const b = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        return b;
      };
      const nodeQuad = quad([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
      const lineQuad = quad([0, -0.5, 1, -0.5, 0, 0.5, 0, 0.5, 1, -0.5, 1, 0.5]);
      // arrow: tip at origin pointing +x; (0,0) (-4,-2) (-3,0) + (0,0) (-3,0) (-4,2)
      const arrowShape = quad([0, 0, -4, -2, -3, 0, 0, 0, -3, 0, -4, 2]);
      const colorBuf = gl.createBuffer()!;
      const lineBuf = gl.createBuffer()!;
      const arrowLinkBuf = gl.createBuffer()!;
      const vao = (shape: WebGLBuffer, inst: WebGLBuffer, color: boolean) => {
        const v = gl.createVertexArray()!;
        gl.bindVertexArray(v);
        gl.bindBuffer(gl.ARRAY_BUFFER, shape);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, inst);
        gl.enableVertexAttribArray(1);
        if (color) gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
        else gl.vertexAttribIPointer(1, 2, gl.UNSIGNED_INT, 0, 0);
        gl.vertexAttribDivisor(1, 1);
        gl.bindVertexArray(null);
        return v;
      };
      const u = new Map<WebGLProgram, Record<string, WebGLUniformLocation | null>>();
      for (const p of [nodeProg, linkProg, arrowProg]) {
        const names = ["u_nodes", "u_view", "u_res", "u_nodeScale", "u_width", "u_hl", "u_fade", "u_color", "u_hlColor", "u_size"];
        u.set(p, Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)])));
      }
      this.glState = {
        gl,
        nodeProg,
        linkProg,
        arrowProg,
        tex,
        texH: 0,
        nodeVao: vao(nodeQuad, colorBuf, true),
        linkVao: vao(lineQuad, lineBuf, false),
        arrowVao: vao(arrowShape, arrowLinkBuf, false),
        colorBuf,
        lineBuf,
        arrowLinkBuf,
        lineCount: 0,
        arrowCount: 0,
        u,
      };
      this.canvasEl.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        this.glState = null;
        this.ctx2d = null;
      });
    } catch (e) {
      console.warn("[graph] WebGL unavailable, using canvas 2D", e);
      this.glState = null;
    }
  }

  private initWorker(): void {
    try {
      const w = new Worker(simulationWorkerUrl(), { name: "Graph layout" });
      w.onmessage = (e) => this.onWorkerMessage(e.data);
      w.onerror = (e) => {
        console.warn("[graph] layout worker failed, running inline", e);
        this.worker = null;
        this.inlineSim = createSimulation();
        this.sendGraph(1);
      };
      this.worker = w;
    } catch {
      this.inlineSim = createSimulation();
    }
  }

  private post(msg: any, transfer: Transferable[] = []): void {
    if (this.worker) {
      this.worker.postMessage(msg, transfer);
      return;
    }
    const sim = this.inlineSim;
    if (!sim) return;
    if (msg.type === "graph") {
      sim.setGraph(msg.n, msg.positions, msg.links);
      if (typeof msg.alpha === "number") sim.alpha = msg.alpha;
    } else if (msg.type === "forces") sim.setForces(msg.forces);
    else if (msg.type === "fix") sim.fix(msg.index, msg.x, msg.y);
    if (typeof msg.alpha === "number" && msg.type !== "graph") sim.alpha = Math.max(sim.alpha, msg.alpha);
    if (typeof msg.alphaTarget === "number") sim.alphaTarget = msg.alphaTarget;
    if (msg.run && !this.inlineTimer) {
      const loop = () => {
        this.inlineTimer = null;
        if (!sim.running() || this.destroyed) return;
        sim.tick();
        const buf = new Float32Array(sim.n * 2);
        for (let i = 0; i < sim.n; i++) {
          buf[i * 2] = sim.x[i];
          buf[i * 2 + 1] = sim.y[i];
        }
        this.onWorkerMessage({ type: "tick", positions: buf, alpha: sim.alpha, running: sim.running() });
        this.inlineTimer = setTimeout(loop, 16);
      };
      this.inlineTimer = setTimeout(loop, 0);
    }
  }

  private onWorkerMessage(m: any): void {
    if (m.type !== "tick") return;
    const p: Float32Array = m.positions;
    const n = Math.min(this.x.length, p.length >> 1);
    for (let i = 0; i < n; i++) {
      this.x[i] = p[i * 2];
      this.y[i] = p[i * 2 + 1];
    }
    if (this.dragNode >= 0 && this.dragNode < n) {
      this.x[this.dragNode] = this.dragFx;
      this.y[this.dragNode] = this.dragFy;
    }
    this.simTicks++;
    this.simAlpha = m.alpha;
    this.simRunning = m.running;
    this.changed();
  }

  // ---------- data ----------
  setData(data: GraphData): void {
    const prev = this.graph;
    const prevPos = new Map<string, [number, number]>();
    let maxR2 = 0;
    for (let i = 0; i < prev.ids.length; i++) prevPos.set(prev.ids[i], [this.x[i], this.y[i]]);
    const g = flatten(data);
    // structural change?
    let structural = g.ids.length !== prev.ids.length || g.src.length !== prev.src.length;
    if (!structural) {
      for (let i = 0; i < g.ids.length && !structural; i++) if (g.ids[i] !== prev.ids[i]) structural = true;
      for (let k = 0; k < g.src.length && !structural; k++) if (g.src[k] !== prev.src[k] || g.dst[k] !== prev.dst[k]) structural = true;
    }
    const n = g.ids.length;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    const fade = new Float32Array(n);
    const placed = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = prevPos.get(g.ids[i]);
      if (p) {
        x[i] = p[0];
        y[i] = p[1];
        placed[i] = 1;
        maxR2 = Math.max(maxR2, p[0] * p[0] + p[1] * p[1]);
        const pi = prev.index.get(g.ids[i]);
        fade[i] = pi !== undefined ? this.fadeAlpha[pi] : 0;
      }
    }
    // place new nodes: near their placed neighbours, else on a ring around the existing layout
    const newCount = n - [...placed].filter(Boolean).length;
    if (newCount > 0) {
      const v = Math.sqrt(maxR2);
      const area = 60 * newCount * 60;
      const ring = Math.sqrt(area / Math.PI + v * v) - v;
      const jitter = Math.sqrt(area);
      const nb: number[][] = Array.from({ length: n }, () => []);
      for (let k = 0; k < g.src.length; k++) {
        nb[g.src[k]].push(g.dst[k]);
        nb[g.dst[k]].push(g.src[k]);
      }
      for (let i = 0; i < n; i++) {
        if (placed[i]) continue;
        let sx = 0, sy = 0, c = 0;
        for (const j of nb[i])
          if (placed[j]) {
            sx += x[j];
            sy += y[j];
            c++;
          }
        if (c > 0) {
          x[i] = sx / c + (Math.random() - 0.5) * jitter;
          y[i] = sy / c + (Math.random() - 0.5) * jitter;
        } else {
          const ang = 2 * Math.random() * Math.PI;
          const r = v + Math.sqrt(Math.random()) * ring;
          x[i] = r * Math.cos(ang);
          y[i] = r * Math.sin(ang);
        }
        placed[i] = 1;
      }
    }
    if (this.dragNode >= 0) this.dragNode = g.index.get(prev.ids[this.dragNode]) ?? -1;
    if (this.highlight >= 0) this.highlight = g.index.get(prev.ids[this.highlight]) ?? -1;
    this.lastHighlight = this.highlight;
    this.graph = g;
    this.x = x;
    this.y = y;
    this.fadeAlpha = fade;
    this.colorsDirty = true;
    this.uploadLinks();
    if (structural) this.sendGraph(0.3);
    this.changed();
  }

  private sendGraph(alpha: number): void {
    const g = this.graph;
    const n = g.ids.length;
    const pos = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      pos[i * 2] = this.x[i];
      pos[i * 2 + 1] = this.y[i];
    }
    const links = new Uint32Array(g.src.length * 2);
    for (let k = 0; k < g.src.length; k++) {
      links[k * 2] = g.src[k];
      links[k * 2 + 1] = g.dst[k];
    }
    this.post({ type: "forces", forces: this.forces });
    this.post({ type: "graph", n, positions: pos, links, alpha, run: true }, [pos.buffer, links.buffer]);
  }

  private uploadLinks(): void {
    const st = this.glState;
    if (!st) return;
    const { gl } = st;
    const g = this.graph;
    // one line per connected pair (A->B and B->A share a line), arrows for every link
    const pairs = new Set<number>();
    const n = g.ids.length;
    const lines: number[] = [];
    for (let k = 0; k < g.src.length; k++) {
      const a = g.src[k], b = g.dst[k];
      const key = a < b ? a * n + b : b * n + a;
      if (pairs.has(key)) continue;
      pairs.add(key);
      lines.push(a, b);
    }
    const lineArr = Uint32Array.from(lines);
    gl.bindBuffer(gl.ARRAY_BUFFER, st.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, lineArr, gl.STATIC_DRAW);
    st.lineCount = lineArr.length / 2;
    const all = new Uint32Array(g.src.length * 2);
    for (let k = 0; k < g.src.length; k++) {
      all[k * 2] = g.src[k];
      all[k * 2 + 1] = g.dst[k];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, st.arrowLinkBuf);
    gl.bufferData(gl.ARRAY_BUFFER, all, gl.STATIC_DRAW);
    st.arrowCount = g.src.length;
  }

  // ---------- options ----------
  setRenderOptions(o: { nodeSizeMultiplier?: number; lineSizeMultiplier?: number; textFadeMultiplier?: number; showArrow?: boolean }): void {
    if (typeof o.nodeSizeMultiplier === "number") this.fNodeSizeMult = o.nodeSizeMultiplier;
    if (typeof o.lineSizeMultiplier === "number") this.fLineSizeMult = o.lineSizeMultiplier;
    if (typeof o.textFadeMultiplier === "number") this.fTextShowMult = o.textFadeMultiplier;
    if (typeof o.showArrow === "boolean") this.fShowArrow = o.showArrow;
    this.textCache.clear();
    this.setScale(this.scale);
    this.changed();
  }

  setForces(f: Partial<SimForces>): void {
    Object.assign(this.forces, f);
    this.post({ type: "forces", forces: f, alpha: 0.3, run: true });
  }

  /** Re-read the colours from CSS (theme or accent changed). */
  testCSS(): void {
    const cs = getComputedStyle(this.containerEl);
    this.fontFamily = cs.getPropertyValue("--font-interface").trim() || cs.fontFamily || "sans-serif";
    for (const [k, cls] of Object.entries(COLOR_CLASSES)) {
      const el = this.containerEl.createDiv("graph-view " + cls);
      const s = getComputedStyle(el);
      const op = parseFloat(s.opacity);
      (this.colors as any)[k] = parseCssColor(s.color, isNaN(op) ? 1 : op);
      el.remove();
    }
    this.textCache.clear();
    this.colorsDirty = true;
    this.changed();
  }

  private nodeColor(i: number): GraphColor {
    const c = this.colors;
    if (i === this.highlight) return c.fillHighlight;
    const t = this.graph.types[i];
    if (t === "focused") {
      if (c.fillFocused.a > 0) return c.fillFocused;
    } else {
      const own = this.graph.colors[i];
      if (own) return own;
      if (t === "tag") return c.fillTag;
      if (t === "unresolved") return c.fillUnresolved;
      if (t === "attachment") return c.fillAttachment;
    }
    return c.fill;
  }

  size(i: number): number {
    return nodeSize(this.graph.weight[i], this.fNodeSizeMult);
  }

  // ---------- view ----------
  onResize(): void {
    const r = this.containerEl.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = window.devicePixelRatio || 1;
    if (w !== this.width || h !== this.height || this.canvasEl.width !== Math.round(w * dpr)) {
      const dx = (w - this.width) / 2;
      const dy = (h - this.height) / 2;
      if (this.width) {
        this.panX += dx;
        this.panY += dy;
      }
      this.width = w;
      this.height = h;
      for (const c of [this.canvasEl, this.overlayEl]) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        c.style.width = w + "px";
        c.style.height = h + "px";
      }
      this.changed();
    }
  }

  resetPan(): void {
    this.panX = this.width / 2;
    this.panY = this.height / 2;
    this.panvX = this.panvY = 0;
    this.changed();
  }

  setScale(s: number): void {
    this.scale = s;
    this.nodeScale = Math.sqrt(1 / s);
    this.textAlpha = Math.min(1, Math.max(0, Math.log2(s) + 1 - this.fTextShowMult));
  }

  zoomTo(s: number, center?: { x: number; y: number }): void {
    this.targetScale = Math.min(8, Math.max(1 / 128, s));
    if (center) {
      this.zoomCenterX = center.x;
      this.zoomCenterY = center.y;
    } else this.zoomCenterX = this.zoomCenterY = 0;
    this.changed();
  }

  private updateZoom(): void {
    let s = this.scale;
    const t = (this.targetScale = Math.min(8, Math.max(1 / 128, this.targetScale)));
    if ((s > t ? s / t : t / s) - 1 >= 0.01) {
      let cx = this.zoomCenterX, cy = this.zoomCenterY;
      if (cx === 0 && cy === 0) {
        cx = this.width / 2;
        cy = this.height / 2;
      }
      const wx = (cx - this.panX) / s;
      const wy = (cy - this.panY) / s;
      s = lerp(s, t, 0.85);
      this.panX = cx - wx * s;
      this.panY = cy - wy * s;
      this.idleFrames = 0;
    } else if (s !== t) s = t;
    this.setScale(s);
  }

  toWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.panX) / this.scale, y: (sy - this.panY) / this.scale };
  }

  /** Node under a point in CSS px relative to the canvas, or -1. */
  hitTest(sx: number, sy: number): number {
    const w = this.toWorld(sx, sy);
    let best = -1;
    let bestD = Infinity;
    const g = this.graph;
    for (let i = 0; i < g.ids.length; i++) {
      const r = this.size(i) * this.nodeScale + 2 / this.scale;
      const dx = this.x[i] - w.x, dy = this.y[i] - w.y;
      const d = dx * dx + dy * dy;
      if (d <= r * r && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // ---------- events ----------
  private bindEvents(): void {
    const el = this.containerEl;
    let down: { x: number; y: number; node: number; panX: number; panY: number; t: number; moved: boolean; button: number } | null = null;
    let lastMoveT = 0;
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 40;
      else if (e.deltaMode === 2) dy *= 800;
      const t = this.targetScale * Math.pow(1.5, -dy / 120);
      const r = this.canvasEl.getBoundingClientRect();
      if (t < this.scale) this.zoomTo(t);
      else this.zoomTo(t, { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });
    el.addEventListener("pointerdown", (e) => {
      if (e.target !== this.overlayEl && e.target !== this.canvasEl) return;
      if (e.button !== 0 && e.button !== 1) return;
      const r = this.canvasEl.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      const node = this.hitTest(sx, sy);
      down = { x: sx, y: sy, node, panX: this.panX, panY: this.panY, t: performance.now(), moved: false, button: e.button };
      el.setPointerCapture(e.pointerId);
      if (node >= 0) {
        this.dragNode = node;
        this.dragFx = this.x[node];
        this.dragFy = this.y[node];
      } else {
        this.panning = true;
        this.panvX = this.panvY = 0;
        document.body.addClass("is-grabbing");
      }
      e.preventDefault();
    });
    el.addEventListener("pointermove", (e) => {
      const r = this.canvasEl.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (down) {
        const dx = sx - down.x, dy = sy - down.y;
        if (dx * dx + dy * dy > 25) down.moved = true;
        if (this.dragNode >= 0 && down.node >= 0) {
          if (!down.moved) return;
          const w = this.toWorld(sx, sy);
          this.dragFx = w.x;
          this.dragFy = w.y;
          this.x[this.dragNode] = w.x;
          this.y[this.dragNode] = w.y;
          this.post({ type: "fix", index: this.dragNode, x: w.x, y: w.y, alpha: 0.3, alphaTarget: 0.3, run: true });
          this.changed();
        } else if (this.panning) {
          const nx = down.panX + dx, ny = down.panY + dy;
          this.panvX = lerp(this.panvX, nx - this.panX, 0.8);
          this.panvY = lerp(this.panvY, ny - this.panY, 0.8);
          lastMoveT = performance.now();
          this.panX = nx;
          this.panY = ny;
          this.changed();
        }
        return;
      }
      const hit = this.hitTest(sx, sy);
      if (hit !== this.highlight) {
        if (this.highlight >= 0) this.hooks.onNodeUnhover?.();
        this.setHighlight(hit);
        if (hit >= 0) this.hooks.onNodeHover?.(e, this.graph.ids[hit], this.graph.types[hit]);
      }
      el.toggleClass("is-hovering-node", hit >= 0);
    });
    const end = (e: PointerEvent) => {
      if (!down) return;
      const d = down;
      down = null;
      if (this.panning) {
        this.panning = false;
        document.body.removeClass("is-grabbing");
        if (performance.now() - lastMoveT > 100) this.panvX = this.panvY = 0;
      }
      if (this.dragNode >= 0) {
        const node = this.dragNode;
        this.dragNode = -1;
        this.post({ type: "fix", index: node, x: null, y: null, alphaTarget: 0 });
        if (!d.moved && node === d.node && e.type === "pointerup") {
          this.hooks.onNodeClick?.(e, this.graph.ids[node], this.graph.types[node]);
        }
      }
      this.changed();
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("pointerleave", () => {
      if (!down && this.highlight >= 0) {
        this.hooks.onNodeUnhover?.();
        this.setHighlight(-1);
      }
    });
    el.addEventListener("contextmenu", (e) => {
      const r = this.canvasEl.getBoundingClientRect();
      const node = this.hitTest(e.clientX - r.left, e.clientY - r.top);
      if (node >= 0) {
        e.preventDefault();
        this.hooks.onNodeRightClick?.(e, this.graph.ids[node], this.graph.types[node]);
      }
    });
  }

  setHighlight(i: number): void {
    if (i === this.highlight) return;
    this.highlight = i;
    if (i >= 0) this.lastHighlight = i;
    this.colorsDirty = true;
    this.changed();
  }

  // ---------- frame loop ----------
  changed(): void {
    this.idleFrames = 0;
    if (!this.frame && !this.destroyed) this.frame = requestAnimationFrame(() => this.render());
  }

  private render(): void {
    this.frame = 0;
    if (this.destroyed) return;
    const t0 = performance.now();
    // inertia + keyboard
    if (!this.panning) {
      const ka = this.keyboardActions;
      this.panX += this.panvX;
      this.panY += this.panvY;
      let kx = 0, ky = 0;
      if (ka.up) ky += 1;
      if (ka.down) ky -= 1;
      if (ka.left) kx += 1;
      if (ka.right) kx -= 1;
      if (kx || ky) this.idleFrames = 0;
      const mul = ka.shift ? 3 : 1;
      this.panvX = lerp(this.panvX, kx * mul * (1000 / 60), 0.9);
      this.panvY = lerp(this.panvY, ky * mul * (1000 / 60), 0.9);
      if (Math.abs(this.panvX) < 0.01) this.panvX = 0;
      if (Math.abs(this.panvY) < 0.01) this.panvY = 0;
      if (ka.zoomin || ka.zoomout) {
        const f = 1 + (ka.shift ? 0.1 : 0.03);
        this.targetScale = ka.zoomin ? this.targetScale * f : this.targetScale / f;
        this.zoomCenterX = this.zoomCenterY = 0;
      }
    }
    this.updateZoom();
    // fades
    const g = this.graph;
    const n = g.ids.length;
    let animating = false;
    const hl = this.highlight;
    const hoverTarget = hl >= 0 ? FADE : 1;
    const prevFade = this.hoverFade;
    this.hoverFade = lerp(this.hoverFade, hoverTarget);
    if (Math.abs(this.hoverFade - hoverTarget) < 0.002) this.hoverFade = hoverTarget;
    if (this.hoverFade !== prevFade) animating = true;
    const ref = hl >= 0 ? hl : this.lastHighlight;
    const neighbours = this.neighbourSet(ref);
    if (this.texData.length < Math.max(1, Math.ceil(n / TEX_W)) * TEX_W * 4) this.texData = new Float32Array(Math.max(1, Math.ceil(n / TEX_W)) * TEX_W * 4);
    const td = this.texData;
    for (let i = 0; i < n; i++) {
      const target = ref < 0 || i === ref || neighbours.has(i) ? 1 : this.hoverFade;
      const f = (this.fadeAlpha[i] = lerp(this.fadeAlpha[i], target));
      if (Math.abs(f - target) > 0.002) animating = true;
      else this.fadeAlpha[i] = target;
      td[i * 4] = this.x[i];
      td[i * 4 + 1] = this.y[i];
      td[i * 4 + 2] = this.size(i);
      td[i * 4 + 3] = this.fadeAlpha[i];
    }
    const mt = hl >= 0 ? 15 : 0;
    this.moveText = lerp(this.moveText, mt);
    if (Math.abs(this.moveText - mt) > 0.05) animating = true;
    if (this.glState) this.drawGL(n);
    else this.draw2D(n);
    this.drawOverlay(n);
    this.frames++;
    this.lastFrameMs = performance.now() - t0;
    if (animating || this.simRunning || this.panvX || this.panvY || Math.abs(this.scale - this.targetScale) > 1e-6) this.idleFrames = 0;
    else this.idleFrames++;
    if (this.idleFrames < 60) this.frame = requestAnimationFrame(() => this.render());
  }

  private nbCache: { i: number; graph: FlatGraph | null; set: Set<number> } = { i: -2, graph: null, set: new Set() };
  private neighbourSet(i: number): Set<number> {
    if (this.nbCache.i === i && this.nbCache.graph === this.graph) return this.nbCache.set;
    const s = new Set<number>();
    this.nbCache = { i, graph: this.graph, set: s };
    if (i < 0) return s;
    const g = this.graph;
    for (let k = 0; k < g.src.length; k++) {
      if (g.src[k] === i) s.add(g.dst[k]);
      else if (g.dst[k] === i) s.add(g.src[k]);
    }
    return s;
  }

  private drawGL(n: number): void {
    const st = this.glState!;
    const gl = st.gl;
    const dpr = window.devicePixelRatio || 1;
    gl.viewport(0, 0, this.canvasEl.width, this.canvasEl.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!n) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // node texture
    const h = Math.max(1, Math.ceil(n / TEX_W));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, st.tex);
    if (st.texH !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEX_W, h, 0, gl.RGBA, gl.FLOAT, this.texData.subarray(0, TEX_W * h * 4));
      st.texH = h;
    } else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEX_W, h, gl.RGBA, gl.FLOAT, this.texData.subarray(0, TEX_W * h * 4));
    // colours
    if (this.colorsDirty) {
      if (this.colorData.length < n * 4) this.colorData = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const c = this.nodeColor(i);
        this.colorData[i * 4] = ((c.rgb >> 16) & 255) / 255;
        this.colorData[i * 4 + 1] = ((c.rgb >> 8) & 255) / 255;
        this.colorData[i * 4 + 2] = (c.rgb & 255) / 255;
        this.colorData[i * 4 + 3] = c.a;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, st.colorBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.colorData.subarray(0, n * 4), gl.DYNAMIC_DRAW);
      this.colorsDirty = false;
    }
    const view = [this.scale, this.panX, this.panY];
    const common = (p: WebGLProgram) => {
      gl.useProgram(p);
      const u = st.u.get(p)!;
      gl.uniform1i(u.u_nodes, 0);
      gl.uniform3fv(u.u_view, view);
      gl.uniform2f(u.u_res, this.width, this.height);
      gl.uniform1f(u.u_nodeScale, this.nodeScale);
      return u;
    };
    const rgba = (c: GraphColor) => [((c.rgb >> 16) & 255) / 255, ((c.rgb >> 8) & 255) / 255, (c.rgb & 255) / 255, c.a];
    const hl = this.highlight >= 0 ? this.highlight : this.hoverFade < 1 ? this.lastHighlight : -1;
    // links
    if (st.lineCount) {
      const u = common(st.linkProg);
      gl.uniform1f(u.u_width, this.fLineSizeMult);
      gl.uniform1i(u.u_hl, hl);
      gl.uniform1f(u.u_fade, this.hoverFade);
      gl.uniform4fv(u.u_color, rgba(this.colors.line));
      gl.uniform4fv(u.u_hlColor, rgba(this.highlight >= 0 ? this.colors.lineHighlight : this.colors.line));
      gl.bindVertexArray(st.linkVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, st.lineCount);
    }
    // arrows
    const arrowAlpha = Math.min(1, Math.max(0, 2 * (this.scale - 0.3)));
    if (this.fShowArrow && st.arrowCount && arrowAlpha > 0.001) {
      const u = common(st.arrowProg);
      gl.uniform1f(u.u_size, 2 * Math.sqrt(this.fLineSizeMult));
      gl.uniform1i(u.u_hl, hl);
      gl.uniform1f(u.u_fade, this.hoverFade);
      const c = rgba(this.colors.arrow);
      c[3] *= arrowAlpha;
      gl.uniform4fv(u.u_color, c);
      gl.bindVertexArray(st.arrowVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, st.arrowCount);
    }
    // nodes
    {
      common(st.nodeProg);
      gl.bindVertexArray(st.nodeVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    }
    gl.bindVertexArray(null);
    void dpr;
  }

  private draw2D(n: number): void {
    if (!this.ctx2d) this.ctx2d = this.canvasEl.getContext("2d");
    const ctx = this.ctx2d;
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    const g = this.graph;
    const s = this.scale;
    const hl = this.highlight >= 0 ? this.highlight : this.hoverFade < 1 ? this.lastHighlight : -1;
    const css = (c: GraphColor, a: number) => `rgba(${(c.rgb >> 16) & 255},${(c.rgb >> 8) & 255},${c.rgb & 255},${c.a * a})`;
    ctx.lineWidth = Math.max(this.fLineSizeMult, 1);
    for (let k = 0; k < g.src.length; k++) {
      const a = g.src[k], b = g.dst[k];
      const conn = hl >= 0 && (a === hl || b === hl);
      ctx.strokeStyle = css(conn && this.highlight >= 0 ? this.colors.lineHighlight : this.colors.line, (conn ? 1 : this.hoverFade) * Math.min(1, this.fLineSizeMult));
      ctx.beginPath();
      ctx.moveTo(this.x[a] * s + this.panX, this.y[a] * s + this.panY);
      ctx.lineTo(this.x[b] * s + this.panX, this.y[b] * s + this.panY);
      ctx.stroke();
    }
    for (let i = 0; i < n; i++) {
      const c = this.nodeColor(i);
      ctx.fillStyle = css(c, this.fadeAlpha[i]);
      ctx.beginPath();
      ctx.arc(this.x[i] * s + this.panX, this.y[i] * s + this.panY, this.size(i) * this.nodeScale * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): { lines: string[]; w: number } {
    const words = text.split(/(\s+)/);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur + w;
      if (cur && ctx.measureText(next.trimEnd()).width > maxW && w.trim()) {
        lines.push(cur.trimEnd());
        cur = w.trimStart();
      } else cur = next;
    }
    if (cur.trim() || !lines.length) lines.push(cur.trim());
    let wmax = 0;
    for (const l of lines) wmax = Math.max(wmax, ctx.measureText(l).width);
    return { lines, w: wmax };
  }

  private drawOverlay(n: number): void {
    const ctx = this.overlayCtx;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlayEl.width, this.overlayEl.height);
    const g = this.graph;
    const s = this.scale;
    const k = Math.sqrt(s); // screen size of one "node unit"
    const textColor = this.colors.text;
    const baseAlpha = this.textAlpha * textColor.a;
    const hl = this.highlight;
    const fg = `rgb(${(textColor.rgb >> 16) & 255},${(textColor.rgb >> 8) & 255},${textColor.rgb & 255})`;
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    // viewport in world units
    const vl = -this.panX / s, vt = -this.panY / s, vr = vl + this.width / s, vb = vt + this.height / s;
    const drawLabel = (i: number, alpha: number, highlighted: boolean) => {
      const size = this.size(i);
      const fontPx = 14 + size / 4;
      const key = g.ids[i] + "|" + fontPx;
      ctx.font = `${fontPx}px ${this.fontFamily}`;
      let wrapped = this.textCache.get(key);
      if (!wrapped) {
        wrapped = this.wrapLines(ctx, nodeDisplayText(g.ids[i]), 300);
        this.textCache.set(key, wrapped);
      }
      const ts = highlighted && s < 1 ? 1 : k; // the hovered label stays readable when zoomed out
      const sx = this.x[i] * s + this.panX;
      const sy = this.y[i] * s + this.panY + (size + 5) * k + (highlighted ? this.moveText : 0);
      ctx.globalAlpha = alpha;
      ctx.setTransform(dpr * ts, 0, 0, dpr * ts, sx * dpr, sy * dpr);
      const lh = fontPx * 1.25;
      for (let l = 0; l < wrapped.lines.length; l++) ctx.fillText(wrapped.lines[l], 0, l * lh);
    };
    this.drawIcons(n, vl, vt, vr, vb);
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    if (baseAlpha > 0.001) {
      for (let i = 0; i < n; i++) {
        if (i === hl) continue;
        const a = baseAlpha * this.fadeAlpha[i];
        if (a <= 0.001) continue;
        const x = this.x[i], y = this.y[i];
        if (x + 300 < vl || x - 300 > vr || y + 200 < vt || y > vb) continue;
        drawLabel(i, a, false);
      }
    }
    if (hl >= 0) {
      // ring around the hovered node, then its label on top
      const size = this.size(hl);
      const E = Math.max(1, 1 / s / this.nodeScale);
      const sx = this.x[hl] * s + this.panX, sy = this.y[hl] * s + this.panY;
      const c = this.colors.circle;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalAlpha = c.a;
      ctx.strokeStyle = `rgb(${(c.rgb >> 16) & 255},${(c.rgb >> 8) & 255},${c.rgb & 255})`;
      ctx.lineWidth = E * this.nodeScale * s;
      ctx.beginPath();
      ctx.arc(sx, sy, (size + E / 2) * this.nodeScale * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = fg;
      drawLabel(hl, textColor.a, true);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /** Emoji from the notes' `icon` property, drawn just above their nodes (the node keeps its colour). */
  private drawIcons(n: number, vl: number, vt: number, vr: number, vb: number): void {
    const icons = this.graph.icons;
    if (!icons || !icons.some(Boolean)) return;
    const ctx = this.overlayCtx;
    const dpr = window.devicePixelRatio || 1;
    const s = this.scale;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let lastPx = -1;
    for (let i = 0; i < n; i++) {
      const icon = icons[i];
      if (!icon) continue;
      const x = this.x[i], y = this.y[i];
      if (x + 60 < vl || x - 60 > vr || y + 60 < vt || y - 60 > vb) continue;
      const r = this.size(i) * this.nodeScale * s; // node radius on screen
      if (r < 3) continue; // zoomed far out: just the coloured dot
      const a = this.fadeAlpha[i];
      if (a <= 0.01) continue;
      const px = Math.round(Math.max(12, Math.min(40, r * 1.6)));
      if (px !== lastPx) {
        ctx.font = `${px}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", ${this.fontFamily}`;
        lastPx = px;
      }
      ctx.globalAlpha = a;
      ctx.fillText(icon, x * s + this.panX, y * s + this.panY - r - px * 0.55);
    }
    ctx.globalAlpha = 1;
  }

  /** Approximate frames per second over `ms` while the view is animating (for benchmarks). */
  async measureFps(ms = 2000): Promise<{ fps: number; frameMs: number }> {
    const f0 = this.frames;
    let worst = 0;
    const t0 = performance.now();
    const keep = setInterval(() => {
      this.changed();
      worst = Math.max(worst, this.lastFrameMs);
    }, 8);
    await new Promise((r) => setTimeout(r, ms));
    clearInterval(keep);
    return { fps: ((this.frames - f0) * 1000) / (performance.now() - t0), frameMs: worst };
  }

  destroy(): void {
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObs.disconnect();
    if (this.worker) {
      this.worker.postMessage({ type: "stop" });
      this.worker.terminate();
    }
    clearTimeout(this.inlineTimer);
    const lose = this.glState?.gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    this.canvasEl.remove();
    this.overlayEl.remove();
  }
}
