// Bases: parsing of .base files and a small expression language for filters and formulas
// (written from the public Bases syntax documentation). Pure TypeScript, no DOM.
//
// Supported: literals ("str", 'str', numbers, true/false, null, [lists]), property references
// (note.x / bare x, file.name|basename|path|folder|ext|size|ctime|mtime|tags|links|properties,
// formula.x, this.file...), operators (== != > < >= <= && || ! + - * / %), parentheses, method calls
// on values (contains, containsAll, containsAny, startsWith, endsWith, isEmpty, lower, upper, trim,
// length, title, toString, round, floor, ceil, format, year, month, day, join, slice, sort, unique,
// reverse), file.hasTag / inFolder / hasLink / hasProperty, and global functions (if, now, today,
// date, number, list, min, max, link, icon). Unknown functions evaluate to null and are reported.
import moment from "moment";
import { parseYaml } from "../../../core/parse";

export interface BaseView {
  type: string;
  name: string;
  filters?: any;
  order?: string[];
  sort?: { property: string; direction?: "ASC" | "DESC" }[];
  limit?: number;
  groupBy?: { property: string; direction?: "ASC" | "DESC" };
  image?: string;
  [k: string]: any;
}
export interface BaseFile {
  filters?: any;
  formulas: Record<string, string>;
  properties: Record<string, { displayName?: string; [k: string]: any }>;
  views: BaseView[];
  /** Keys we don't understand, kept as-is. */
  extra: Record<string, any>;
}

export function parseBase(text: string): BaseFile {
  let raw: any = {};
  if (text.trim()) {
    raw = parseYaml(text);
    if (raw === null || raw === undefined) raw = {};
    if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("A .base file must be a YAML mapping (key: value pairs).");
  }
  const { filters, formulas, properties, views, ...extra } = raw;
  const vs: BaseView[] = Array.isArray(views) ? views.filter((v) => v && typeof v === "object").map((v, i) => ({ ...v, type: String(v.type ?? "table"), name: String(v.name ?? `View ${i + 1}`) })) : [];
  if (!vs.length) vs.push({ type: "table", name: "Table" });
  return {
    filters,
    formulas: formulas && typeof formulas === "object" ? Object.fromEntries(Object.entries(formulas).map(([k, v]) => [k, String(v)])) : {},
    properties: properties && typeof properties === "object" ? properties : {},
    views: vs,
    extra,
  };
}

// ---------------------------------------------------------------- tokenizer
type Tok = { t: "num" | "str" | "id" | "op" | "eof"; v: any; pos: number };
const OPS = ["==", "!=", ">=", "<=", "&&", "||", "(", ")", "[", "]", ",", ".", ">", "<", "!", "+", "-", "*", "/", "%"];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1,
        s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          s += src[j + 1];
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new Error(`Unclosed quote at ${i + 1}`);
      out.push({ t: "str", v: s, pos: i });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(src.slice(i))!;
      out.push({ t: "num", v: parseFloat(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$À-￿]/.test(c)) {
      const m = /^[A-Za-z_$À-￿][\w$À-￿-]*/.exec(src.slice(i))!;
      // Hyphens are allowed inside names (property "due-date"), but "a - b" needs spaces.
      out.push({ t: "id", v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`Unexpected “${c}” at ${i + 1}`);
    out.push({ t: "op", v: op, pos: i });
    i += op.length;
  }
  out.push({ t: "eof", v: null, pos: src.length });
  return out;
}

// ---------------------------------------------------------------- parser (Pratt)
export type Node =
  | { k: "lit"; v: any }
  | { k: "id"; name: string }
  | { k: "list"; items: Node[] }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "get"; obj: Node; name: string }
  | { k: "idx"; obj: Node; index: Node }
  | { k: "call"; fn: Node; args: Node[] };

const PREC: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, ">": 4, "<": 4, ">=": 4, "<=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

export function parseExpr(src: string): Node {
  const toks = tokenize(String(src));
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (v: string) => {
    const t = next();
    if (t.t !== "op" || t.v !== v) throw new Error(`Expected “${v}” at ${t.pos + 1}`);
  };
  const primary = (): Node => {
    const t = next();
    if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v };
    if (t.t === "id") {
      if (t.v === "true") return { k: "lit", v: true };
      if (t.v === "false") return { k: "lit", v: false };
      if (t.v === "null") return { k: "lit", v: null };
      return { k: "id", name: t.v };
    }
    if (t.t === "op" && t.v === "(") {
      const e = expr(0);
      expect(")");
      return e;
    }
    if (t.t === "op" && t.v === "[") {
      const items: Node[] = [];
      if (!(peek().t === "op" && peek().v === "]"))
        do items.push(expr(0));
        while (peek().t === "op" && peek().v === "," && next());
      expect("]");
      return { k: "list", items };
    }
    if (t.t === "op" && (t.v === "!" || t.v === "-")) return { k: "un", op: t.v, a: postfix(primary()) };
    throw new Error(t.t === "eof" ? "The expression ends too early" : `Unexpected “${t.v}” at ${t.pos + 1}`);
  };
  const postfix = (n: Node): Node => {
    for (;;) {
      const t = peek();
      if (t.t === "op" && t.v === ".") {
        next();
        const id = next();
        if (id.t !== "id") throw new Error(`Expected a name after “.” at ${id.pos + 1}`);
        n = { k: "get", obj: n, name: id.v };
      } else if (t.t === "op" && t.v === "(") {
        next();
        const args: Node[] = [];
        if (!(peek().t === "op" && peek().v === ")"))
          do args.push(expr(0));
          while (peek().t === "op" && peek().v === "," && next());
        expect(")");
        n = { k: "call", fn: n, args };
      } else if (t.t === "op" && t.v === "[") {
        next();
        const index = expr(0);
        expect("]");
        n = { k: "idx", obj: n, index };
      } else return n;
    }
  };
  const expr = (min: number): Node => {
    let left = postfix(primary());
    for (;;) {
      const t = peek();
      const prec = t.t === "op" ? PREC[t.v] : undefined;
      if (prec === undefined || prec <= min - 1 || prec < min) return left;
      next();
      const right = expr(prec + 1);
      left = { k: "bin", op: t.v, a: left, b: right };
    }
  };
  const e = expr(0);
  if (peek().t !== "eof") throw new Error(`Unexpected “${peek().v}” at ${peek().pos + 1}`);
  return e;
}

// ---------------------------------------------------------------- evaluation
export interface FileLike {
  name: string; // with extension
  basename: string;
  path: string;
  extension: string;
  parentPath: string;
  size: number;
  ctime: number;
  mtime: number;
  tags: string[]; // without '#'
  links: string[]; // resolved paths
  properties: Record<string, any>;
}
export interface EvalContext {
  file: FileLike;
  formulas: Record<string, string>;
  /** The file showing the base (for `this`). */
  thisFile?: FileLike | null;
  errors?: Set<string>;
}

const isDate = (v: any) => moment.isMoment(v);
const asNum = (v: any): number => (isDate(v) ? v.valueOf() : typeof v === "number" ? v : v === null || v === undefined || v === "" ? NaN : Number(v));

function toDate(v: any): moment.Moment | null {
  if (isDate(v)) return v;
  if (typeof v === "number") return moment(v);
  if (typeof v === "string") {
    const m = moment(v, [moment.ISO_8601, "YYYY-MM-DD", "YYYY-MM-DD HH:mm", "YYYY-MM-DDTHH:mm:ss"], true);
    return m.isValid() ? m : null;
  }
  return null;
}

function eq(a: any, b: any): boolean {
  if (isDate(a) || isDate(b)) {
    const x = toDate(a),
      y = toDate(b);
    return !!x && !!y && x.valueOf() === y.valueOf();
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]));
  if (typeof a === "string" && typeof b === "string") return a === b;
  if ((typeof a === "number" || typeof b === "number") && a !== null && b !== null && a !== "" && b !== "") return asNum(a) === asNum(b);
  return a === b || (a == null && b == null);
}

function compare(a: any, b: any): number {
  if (isDate(a) || isDate(b)) {
    const x = toDate(a)?.valueOf() ?? NaN,
      y = toDate(b)?.valueOf() ?? NaN;
    return x - y;
  }
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return asNum(a) - asNum(b);
}

export function truthy(v: any): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object" && !isDate(v)) return Object.keys(v).length > 0;
  return !!v;
}

function propValue(ctx: EvalContext, name: string, file: FileLike = ctx.file): any {
  const props = file.properties ?? {};
  if (name in props) return props[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(props)) if (k.toLowerCase() === lower) return props[k];
  return null;
}

/** A property id as used in `order`/`sort`/`properties` ("note.x", "file.name", "formula.y", "x"). */
export function valueOf(ctx: EvalContext, id: string): any {
  if (id.startsWith("formula.")) return evalFormula(ctx, id.slice(8));
  if (id.startsWith("file.")) return fileField(ctx.file, id.slice(5));
  if (id.startsWith("note.")) return propValue(ctx, id.slice(5));
  return propValue(ctx, id);
}

function fileField(f: FileLike, field: string): any {
  switch (field) {
    case "name":
      return f.name;
    case "basename":
      return f.basename;
    case "path":
      return f.path;
    case "folder":
      return f.parentPath;
    case "ext":
      return f.extension;
    case "size":
      return f.size;
    case "ctime":
      return moment(f.ctime);
    case "mtime":
      return moment(f.mtime);
    case "tags":
      return f.tags.map((t) => "#" + t);
    case "links":
      return f.links;
    case "properties":
      return f.properties;
    case "file":
      return f;
  }
  return null;
}

const stack: string[] = [];
function evalFormula(ctx: EvalContext, name: string): any {
  const src = ctx.formulas[name];
  if (src === undefined) return null;
  if (stack.includes(name)) {
    ctx.errors?.add(`Formula “${name}” refers to itself.`);
    return null;
  }
  stack.push(name);
  try {
    return evaluate(parseCached(src), ctx);
  } catch (e: any) {
    ctx.errors?.add(`Formula “${name}”: ${e?.message ?? e}`);
    return null;
  } finally {
    stack.pop();
  }
}

const parsed = new Map<string, Node>();
export function parseCached(src: string): Node {
  let n = parsed.get(src);
  if (!n) {
    n = parseExpr(src);
    if (parsed.size > 2000) parsed.clear();
    parsed.set(src, n);
  }
  return n;
}

const FILE_OBJ = Symbol("file");
interface FileRef {
  [FILE_OBJ]: FileLike;
}

export function evaluate(n: Node, ctx: EvalContext): any {
  switch (n.k) {
    case "lit":
      return n.v;
    case "list":
      return n.items.map((x) => evaluate(x, ctx));
    case "id": {
      if (n.name === "file") return { [FILE_OBJ]: ctx.file } as FileRef;
      if (n.name === "note") return { __note: true };
      if (n.name === "formula") return { __formula: true };
      if (n.name === "this") return ctx.thisFile ? ({ [FILE_OBJ]: ctx.thisFile, __this: true } as any) : null;
      return { __global: n.name, __value: propValue(ctx, n.name) };
    }
    case "un": {
      const a = deref(evaluate(n.a, ctx));
      return n.op === "!" ? !truthy(a) : -asNum(a);
    }
    case "bin": {
      if (n.op === "&&") return truthy(deref(evaluate(n.a, ctx))) ? truthy(deref(evaluate(n.b, ctx))) : false;
      if (n.op === "||") return truthy(deref(evaluate(n.a, ctx))) || truthy(deref(evaluate(n.b, ctx)));
      const a = deref(evaluate(n.a, ctx)),
        b = deref(evaluate(n.b, ctx));
      switch (n.op) {
        case "==":
          return eq(a, b);
        case "!=":
          return !eq(a, b);
        case ">":
          return compare(a, b) > 0;
        case "<":
          return compare(a, b) < 0;
        case ">=":
          return compare(a, b) >= 0;
        case "<=":
          return compare(a, b) <= 0;
        case "+":
          if (isDate(a) && typeof b === "string") return addDuration(a, b, 1);
          if (typeof a === "string" || typeof b === "string") return `${fmt(a)}${fmt(b)}`;
          return asNum(a) + asNum(b);
        case "-":
          if (isDate(a) && typeof b === "string") return addDuration(a, b, -1);
          if (isDate(a) && isDate(b)) return a.valueOf() - b.valueOf();
          return asNum(a) - asNum(b);
        case "*":
          return asNum(a) * asNum(b);
        case "/":
          return asNum(a) / asNum(b);
        case "%":
          return asNum(a) % asNum(b);
      }
      return null;
    }
    case "get": {
      const o = evaluate(n.obj, ctx);
      if (o && (o as any)[FILE_OBJ]) {
        const f = (o as any)[FILE_OBJ] as FileLike;
        if (n.name === "file") return o;
        const v = fileField(f, n.name);
        return v === null && !(o as any).__this ? propValue(ctx, n.name, f) : v === null ? propValue(ctx, n.name, f) : v;
      }
      if (o && o.__note) return propValue(ctx, n.name);
      if (o && o.__formula) return evalFormula(ctx, n.name);
      const v = deref(o);
      if (v && typeof v === "object" && !Array.isArray(v) && !isDate(v)) return v[n.name] ?? null;
      // Property-like accessors on values.
      if (n.name === "length") return Array.isArray(v) || typeof v === "string" ? v.length : null;
      return { __method: n.name, __on: v };
    }
    case "idx": {
      const o = deref(evaluate(n.obj, ctx));
      const i = deref(evaluate(n.index, ctx));
      if (Array.isArray(o)) return o[i < 0 ? o.length + i : i] ?? null;
      if (o && typeof o === "object") return o[i] ?? null;
      return null;
    }
    case "call": {
      const args = n.args.map((a) => deref(evaluate(a, ctx)));
      if (n.fn.k === "id") return callGlobal(n.fn.name, args, n, ctx);
      const target = evaluate(n.fn, ctx);
      if (n.fn.k === "get") {
        const obj = evaluate(n.fn.obj, ctx);
        if (obj && (obj as any)[FILE_OBJ]) return fileMethod((obj as any)[FILE_OBJ], n.fn.name, args, ctx);
        if (target && target.__method) return callMethod(target.__on, target.__method, args, ctx);
        return callMethod(deref(obj), n.fn.name, args, ctx);
      }
      return null;
    }
  }
}

function deref(v: any): any {
  if (v && typeof v === "object" && "__global" in v) return v.__value;
  if (v && typeof v === "object" && (v as any)[FILE_OBJ]) return (v as any)[FILE_OBJ].path;
  if (v && typeof v === "object" && "__method" in v) return null;
  return v;
}

function addDuration(d: moment.Moment, s: string, sign: 1 | -1): moment.Moment {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*([a-zA-Z]+)\s*$/.exec(s);
  if (!m) return d;
  const unitMap: Record<string, moment.unitOfTime.DurationConstructor> = { y: "years", year: "years", years: "years", M: "months", month: "months", months: "months", w: "weeks", week: "weeks", weeks: "weeks", d: "days", day: "days", days: "days", h: "hours", hour: "hours", hours: "hours", m: "minutes", minute: "minutes", minutes: "minutes", s: "seconds", second: "seconds", seconds: "seconds" };
  const u = unitMap[m[2]] ?? unitMap[m[2].toLowerCase()];
  return u ? d.clone().add(sign * parseFloat(m[1]), u) : d;
}

function fileMethod(f: FileLike, name: string, args: any[], ctx: EvalContext): any {
  switch (name) {
    case "hasTag":
      return args.some((t) => {
        const tag = String(t).replace(/^#/, "").toLowerCase();
        return f.tags.some((x) => x.toLowerCase() === tag || x.toLowerCase().startsWith(tag + "/"));
      });
    case "inFolder": {
      const folder = String(args[0] ?? "").replace(/^\/+|\/+$/g, "");
      return !folder || f.parentPath === folder || f.parentPath.startsWith(folder + "/");
    }
    case "hasLink": {
      const target = String(args[0] ?? "");
      return f.links.some((l) => l === target || l.replace(/\.md$/, "") === target.replace(/\.md$/, "") || l.split("/").pop()?.replace(/\.md$/, "") === target);
    }
    case "hasProperty":
      return propValue(ctx, String(args[0]), f) !== null;
    case "asLink":
      return f.path;
  }
  ctx.errors?.add(`Unknown function file.${name}()`);
  return null;
}

function callMethod(v: any, name: string, args: any[], ctx: EvalContext): any {
  const s = () => fmt(v);
  switch (name) {
    case "contains":
      return Array.isArray(v) ? v.some((x) => eq(x, args[0]) || (typeof x === "string" && typeof args[0] === "string" && x.toLowerCase() === args[0].toLowerCase())) : s().includes(String(args[0] ?? ""));
    case "containsAll":
      return args.every((a) => (Array.isArray(v) ? v.some((x) => eq(x, a)) : s().includes(String(a))));
    case "containsAny":
      return args.some((a) => (Array.isArray(v) ? v.some((x) => eq(x, a)) : s().includes(String(a))));
    case "startsWith":
      return s().startsWith(String(args[0] ?? ""));
    case "endsWith":
      return s().endsWith(String(args[0] ?? ""));
    case "isEmpty":
      return v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length) || (typeof v === "object" && !isDate(v) && !Object.keys(v).length);
    case "lower":
      return s().toLowerCase();
    case "upper":
      return s().toUpperCase();
    case "trim":
      return s().trim();
    case "title":
      return s().replace(/\b\w/g, (c) => c.toUpperCase());
    case "toString":
      return s();
    case "replace":
      return s().split(String(args[0] ?? "")).join(String(args[1] ?? ""));
    case "split":
      return s().split(String(args[0] ?? ""));
    case "round": {
      const p = Math.pow(10, Number(args[0] ?? 0));
      return Math.round(asNum(v) * p) / p;
    }
    case "floor":
      return Math.floor(asNum(v));
    case "ceil":
      return Math.ceil(asNum(v));
    case "abs":
      return Math.abs(asNum(v));
    case "toFixed":
      return asNum(v).toFixed(Number(args[0] ?? 0));
    case "format": {
      const d = toDate(v);
      return d ? d.format(String(args[0] ?? "YYYY-MM-DD")) : null;
    }
    case "date": {
      const d = toDate(v);
      return d ? d.clone().startOf("day") : null;
    }
    case "year":
      return toDate(v)?.year() ?? null;
    case "month":
      return toDate(v) ? toDate(v)!.month() + 1 : null;
    case "day":
      return toDate(v)?.date() ?? null;
    case "relative": {
      const d = toDate(v);
      return d ? d.fromNow() : null;
    }
    case "join":
      return Array.isArray(v) ? v.map(fmt).join(String(args[0] ?? ", ")) : s();
    case "slice":
      return Array.isArray(v) || typeof v === "string" ? v.slice(args[0], args[1]) : null;
    case "sort":
      return Array.isArray(v) ? [...v].sort(compare) : v;
    case "unique":
      return Array.isArray(v) ? v.filter((x, i) => v.findIndex((y) => eq(x, y)) === i) : v;
    case "reverse":
      return Array.isArray(v) ? [...v].reverse() : typeof v === "string" ? [...v].reverse().join("") : v;
    case "flat":
      return Array.isArray(v) ? v.flat() : v;
    case "length":
      return Array.isArray(v) || typeof v === "string" ? v.length : null;
    case "isTruthy":
      return truthy(v);
  }
  ctx.errors?.add(`Unknown function ${name}()`);
  return null;
}

function callGlobal(name: string, args: any[], n: Node, ctx: EvalContext): any {
  switch (name) {
    case "if":
      return truthy(args[0]) ? args[1] : args[2] ?? null;
    case "now":
      return moment();
    case "today":
      return moment().startOf("day");
    case "date":
      return toDate(args[0]);
    case "number":
      return asNum(args[0]);
    case "list":
      return Array.isArray(args[0]) ? args[0] : args[0] === null || args[0] === undefined ? [] : [args[0]];
    case "min":
      return Math.min(...args.flat().map(asNum));
    case "max":
      return Math.max(...args.flat().map(asNum));
    case "link":
      return String(args[0] ?? "");
    case "icon":
      return String(args[0] ?? "");
    case "duration":
      return String(args[0] ?? "");
  }
  void n;
  ctx.errors?.add(`Unknown function ${name}()`);
  return null;
}

/** Display text for a value. */
export function fmt(v: any): string {
  if (v === null || v === undefined) return "";
  if (isDate(v)) return v.hours() || v.minutes() ? v.format("YYYY-MM-DD HH:mm") : v.format("YYYY-MM-DD");
  if (Array.isArray(v)) return v.map(fmt).join(", ");
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ---------------------------------------------------------------- filters
/** Filters are a string expression, or {and|or|not: [filters]}. */
export function matchesFilter(filter: any, ctx: EvalContext): boolean {
  if (filter === undefined || filter === null || filter === "") return true;
  if (typeof filter === "string") {
    try {
      return truthy(deref(evaluate(parseCached(filter), ctx)));
    } catch (e: any) {
      ctx.errors?.add(`Filter “${filter}”: ${e?.message ?? e}`);
      return false;
    }
  }
  if (typeof filter === "boolean") return filter;
  if (Array.isArray(filter)) return filter.every((f) => matchesFilter(f, ctx));
  if (typeof filter === "object") {
    if (Array.isArray(filter.and)) return filter.and.every((f: any) => matchesFilter(f, ctx));
    if (Array.isArray(filter.or)) return filter.or.some((f: any) => matchesFilter(f, ctx));
    if (Array.isArray(filter.not)) return !filter.not.some((f: any) => matchesFilter(f, ctx));
  }
  return true;
}

export interface QueryResult {
  rows: { file: FileLike; values: Record<string, any> }[];
  columns: string[];
  groups?: { key: string; rows: { file: FileLike; values: Record<string, any> }[] }[];
  errors: string[];
}

/** Evaluate a view: filter (base + view), compute the columns, sort, group, limit. */
export function runView(base: BaseFile, view: BaseView, files: FileLike[], thisFile: FileLike | null = null): QueryResult {
  const errors = new Set<string>();
  const columns = view.order?.length ? view.order.map(String) : ["file.name"];
  const rows: QueryResult["rows"] = [];
  for (const f of files) {
    const ctx: EvalContext = { file: f, formulas: base.formulas, thisFile, errors };
    if (!matchesFilter(base.filters, ctx) || !matchesFilter(view.filters, ctx)) continue;
    const values: Record<string, any> = {};
    for (const c of columns) values[c] = valueOf(ctx, c);
    for (const s of view.sort ?? []) if (s?.property && !(s.property in values)) values[s.property] = valueOf(ctx, s.property);
    if (view.groupBy?.property && !(view.groupBy.property in values)) values[view.groupBy.property] = valueOf(ctx, view.groupBy.property);
    rows.push({ file: f, values });
  }
  const sorts = (view.sort ?? []).filter((s) => s && s.property);
  if (sorts.length)
    rows.sort((a, b) => {
      for (const s of sorts) {
        const x = a.values[s.property],
          y = b.values[s.property];
        const empty = (v: any) => v === null || v === undefined || v === "";
        if (empty(x) && empty(y)) continue;
        if (empty(x)) return 1;
        if (empty(y)) return -1;
        const c = compare(x, y) || (typeof x === "string" || typeof y === "string" ? fmt(x).localeCompare(fmt(y)) : 0);
        if (c) return String(s.direction ?? "ASC").toUpperCase() === "DESC" ? -c : c;
      }
      return 0;
    });
  const limited = view.limit && view.limit > 0 ? rows.slice(0, view.limit) : rows;
  let groups: QueryResult["groups"];
  if (view.groupBy?.property) {
    const m = new Map<string, QueryResult["rows"]>();
    for (const r of limited) {
      const k = fmt(r.values[view.groupBy.property]);
      (m.get(k) ?? m.set(k, []).get(k)!).push(r);
    }
    const dir = String(view.groupBy.direction ?? "ASC").toUpperCase() === "DESC" ? -1 : 1;
    groups = [...m.entries()].sort((a, b) => dir * (a[0] === "" ? 1 : b[0] === "" ? -1 : a[0].localeCompare(b[0], undefined, { numeric: true }))).map(([key, rows]) => ({ key, rows }));
  }
  return { rows: limited, columns, groups, errors: [...errors] };
}

/** Header text for a column id. */
export function columnLabel(base: BaseFile, id: string): string {
  const dn = base.properties?.[id]?.displayName;
  if (dn) return String(dn);
  if (id === "file.name") return "file name";
  if (id.startsWith("note.")) return id.slice(5);
  if (id.startsWith("formula.")) return id.slice(8);
  return id;
}
