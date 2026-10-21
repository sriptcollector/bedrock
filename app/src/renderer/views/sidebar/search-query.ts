// Search query language: tokenizer, parser, matcher and "explain" text. Pure TS (no DOM), so it
// runs in unit tests. Written from observed behaviour of the Search pane:
//   words are ANDed, OR, -negation, (grouping), "exact phrases", /regex/,
//   file: path: content: tag: line:() block:() section:() task: task-todo: task-done:
//   match-case: ignore-case:, [property], [property:value], [property:>5], [property:EMPTY].
import type { CachedMetadata } from "obsidian";

export type Range = [number, number];

export type QueryNode =
  | { type: "and"; children: QueryNode[] }
  | { type: "or"; children: QueryNode[] }
  | { type: "not"; child: QueryNode }
  | { type: "term"; text: string; exact: boolean }
  | { type: "regex"; source: string; re: RegExp | null }
  | { type: "all" }
  | { type: "op"; op: OperatorName; child: QueryNode }
  | { type: "case"; sensitive: boolean; child: QueryNode }
  | { type: "prop"; key: QueryNode; value: PropValue | null };

export type PropValue =
  | { kind: "query"; node: QueryNode }
  | { kind: "compare"; cmp: ">" | "<" | ">=" | "<="; value: string }
  | { kind: "empty" }
  | { kind: "bool"; value: boolean };

export const OPERATORS = ["file", "path", "content", "tag", "line", "block", "section", "task", "task-todo", "task-done", "match-case", "ignore-case"] as const;
export type OperatorName = (typeof OPERATORS)[number];

// ---------------------------------------------------------------- tokenizer
type Tok =
  | { t: "lp" }
  | { t: "rp" }
  | { t: "or" }
  | { t: "not" }
  | { t: "word"; v: string }
  | { t: "str"; v: string }
  | { t: "re"; v: string }
  | { t: "prop"; v: string }
  | { t: "op"; op: OperatorName; rest: string };

const OP_RE = new RegExp(`^(${OPERATORS.map((o) => o.replace("-", "\\-")).join("|")}):`, "i");

export function tokenize(q: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = q.length;
  const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";
  // Reads a primary starting at i ("..", /../, [..] or a word). Returns the token and new index.
  const readQuoted = (start: number): [string, number] => {
    let s = "";
    let j = start + 1;
    while (j < n && q[j] !== '"') {
      if (q[j] === "\\" && j + 1 < n) {
        s += q[j + 1];
        j += 2;
      } else s += q[j++];
    }
    return [s, j + 1];
  };
  const readRegex = (start: number): [string, number] | null => {
    let j = start + 1;
    let s = "";
    while (j < n && q[j] !== "/") {
      if (q[j] === "\\" && j + 1 < n) {
        s += q[j] + q[j + 1];
        j += 2;
      } else s += q[j++];
    }
    if (j >= n || !s) return null;
    return [s, j + 1];
  };
  const readBracket = (start: number): [string, number] => {
    let depth = 0;
    let j = start;
    let inQ = false;
    for (; j < n; j++) {
      const c = q[j];
      if (c === '"' && q[j - 1] !== "\\") inQ = !inQ;
      if (inQ) continue;
      if (c === "[") depth++;
      else if (c === "]") {
        depth--;
        if (depth === 0) break;
      }
    }
    return [q.slice(start + 1, j), Math.min(j + 1, n)];
  };
  const readWord = (start: number): [string, number] => {
    let j = start;
    while (j < n && !isSpace(q[j]) && q[j] !== "(" && q[j] !== ")" && q[j] !== '"') j++;
    return [q.slice(start, j), j];
  };
  while (i < n) {
    const c = q[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    if (c === "(") {
      out.push({ t: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ t: "rp" });
      i++;
      continue;
    }
    if (c === '"') {
      const [s, j] = readQuoted(i);
      out.push({ t: "str", v: s });
      i = j;
      continue;
    }
    if (c === "-" && i + 1 < n && !isSpace(q[i + 1])) {
      out.push({ t: "not" });
      i++;
      continue;
    }
    if (c === "/") {
      const r = readRegex(i);
      if (r) {
        out.push({ t: "re", v: r[0] });
        i = r[1];
        continue;
      }
    }
    if (c === "[") {
      const [s, j] = readBracket(i);
      out.push({ t: "prop", v: s });
      i = j;
      continue;
    }
    const m = OP_RE.exec(q.slice(i));
    if (m) {
      const op = m[1].toLowerCase() as OperatorName;
      i += m[0].length;
      // Operand glued to the operator: a word (path:Projects). Otherwise the next primary
      // ("..", /../, (..)) is the operand, or nothing at all (task:).
      if (i < n && !isSpace(q[i]) && q[i] !== "(" && q[i] !== '"' && q[i] !== "/" && q[i] !== ")") {
        const [w, j] = readWord(i);
        out.push({ t: "op", op, rest: w });
        i = j;
      } else out.push({ t: "op", op, rest: "" });
      continue;
    }
    const [w, j] = readWord(i);
    if (w === "OR") out.push({ t: "or" });
    else out.push({ t: "word", v: w });
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------- parser
export function parseQuery(q: string): QueryNode | null {
  const toks = tokenize(q);
  let p = 0;
  const peek = () => toks[p];
  const parseOr = (): QueryNode | null => {
    const parts: QueryNode[] = [];
    const first = parseAnd();
    if (first) parts.push(first);
    while (peek()?.t === "or") {
      p++;
      const nx = parseAnd();
      if (nx) parts.push(nx);
    }
    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : { type: "or", children: parts };
  };
  const parseAnd = (): QueryNode | null => {
    const parts: QueryNode[] = [];
    while (p < toks.length) {
      const t = peek();
      if (t.t === "or" || t.t === "rp") break;
      const u = parseUnary();
      if (u) parts.push(u);
    }
    if (!parts.length) return null;
    return parts.length === 1 ? parts[0] : { type: "and", children: parts };
  };
  const parseUnary = (): QueryNode | null => {
    const t = toks[p++];
    if (!t) return null;
    switch (t.t) {
      case "not": {
        const c = parseUnary();
        return c ? { type: "not", child: c } : null;
      }
      case "op": {
        let child: QueryNode | null;
        if (t.rest) child = wordNode(t.rest);
        else {
          const nx = peek();
          child = nx && nx.t !== "or" && nx.t !== "rp" && nx.t !== "op" ? parseUnary() : null;
          if (!child && nx?.t === "op") child = parseUnary();
        }
        if (t.op === "match-case" || t.op === "ignore-case") return child ? { type: "case", sensitive: t.op === "match-case", child } : null;
        return { type: "op", op: t.op, child: child ?? { type: "all" } };
      }
      case "lp": {
        const inner = parseOr();
        if (peek()?.t === "rp") p++;
        return inner;
      }
      case "rp":
        return null;
      case "str":
        return { type: "term", text: t.v, exact: true };
      case "re":
        return regexNode(t.v);
      case "prop":
        return parseProp(t.v);
      case "word":
        return wordNode(t.v);
      case "or":
        return null;
    }
  };
  return parseOr();
}

function regexNode(source: string): QueryNode {
  let re: RegExp | null = null;
  try {
    re = new RegExp(source);
  } catch {
    re = null;
  }
  return { type: "regex", source, re };
}

function wordNode(w: string): QueryNode {
  if (w.length > 2 && w.startsWith("/") && w.endsWith("/")) return regexNode(w.slice(1, -1));
  if (w.length >= 2 && w.startsWith('"') && w.endsWith('"')) return { type: "term", text: w.slice(1, -1), exact: true };
  return { type: "term", text: w, exact: false };
}

function splitTopColon(s: string): [string, string | null] {
  let inQ = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' && s[i - 1] !== "\\") inQ = !inQ;
    if (inQ) continue;
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ":" && depth === 0) return [s.slice(0, i), s.slice(i + 1)];
  }
  return [s, null];
}

function parseProp(inner: string): QueryNode {
  const [k, v] = splitTopColon(inner);
  const key = parseQuery(k.trim()) ?? { type: "all" };
  if (v === null) return { type: "prop", key, value: null };
  const vt = v.trim();
  let value: PropValue;
  const cmp = /^(>=|<=|>|<)\s*(.+)$/.exec(vt);
  if (cmp) value = { kind: "compare", cmp: cmp[1] as any, value: cmp[2].replace(/^"|"$/g, "") };
  else if (vt === "EMPTY") value = { kind: "empty" };
  else if (vt === "TRUE" || vt === "FALSE") value = { kind: "bool", value: vt === "TRUE" };
  else value = { kind: "query", node: parseQuery(vt) ?? { type: "all" } };
  return { type: "prop", key, value };
}

// ---------------------------------------------------------------- matching
export interface SearchDoc {
  path: string;
  /** File name with extension. */
  name: string;
  basename: string;
  extension: string;
  content: string;
  lower: string;
  meta: CachedMetadata | null;
}

export interface MatchResult {
  content: Range[];
  name: Range[];
  path: Range[];
}

interface Scope {
  text: string;
  lower: string;
  offset: number;
  /** Where ranges found in `text` are reported. */
  target: "content" | "name" | "path" | "none";
  /** File-level scope: plain terms also match the file name, and file-level operators apply. */
  whole: boolean;
  doc: SearchDoc;
}

export function makeDoc(path: string, content: string, meta: CachedMetadata | null): SearchDoc {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return { path, name, basename: dot > 0 ? name.slice(0, dot) : name, extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : "", content, lower: content.toLowerCase(), meta };
}

const empty = (): MatchResult => ({ content: [], name: [], path: [] });

function merge(into: MatchResult, r: MatchResult): void {
  into.content.push(...r.content);
  into.name.push(...r.name);
  into.path.push(...r.path);
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** All occurrences of `needle`; with `wholeWord`, only where it isn't glued to letters or digits. */
function findAll(hay: string, needle: string, offset: number, out: Range[], wholeWord = false): boolean {
  if (!needle) return false;
  let from = 0;
  let found = false;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    const end = i + needle.length;
    if (wholeWord && ((i > 0 && WORD_CHAR.test(hay[i - 1]) && WORD_CHAR.test(needle[0])) || (end < hay.length && WORD_CHAR.test(hay[end]) && WORD_CHAR.test(needle[needle.length - 1])))) {
      from = i + 1;
      continue;
    }
    out.push([offset + i, offset + i + needle.length]);
    found = true;
    from = i + needle.length;
  }
  return found;
}

function report(scope: Scope, ranges: Range[], res: MatchResult): void {
  if (scope.target === "content") res.content.push(...ranges);
  else if (scope.target === "name") res.name.push(...ranges);
  else if (scope.target === "path") res.path.push(...ranges);
}

function evalTextual(node: QueryNode & { type: "term" | "regex" }, scope: Scope, cs: boolean): MatchResult | null {
  const res = empty();
  const ranges: Range[] = [];
  let hit = false;
  if (node.type === "term") {
    const needle = cs ? node.text : node.text.toLowerCase();
    hit = findAll(cs ? scope.text : scope.lower, needle, scope.offset, ranges, node.exact);
    report(scope, ranges, res);
    if (scope.whole && scope.target === "content") {
      const nr: Range[] = [];
      if (findAll(cs ? scope.doc.name : scope.doc.name.toLowerCase(), needle, 0, nr, node.exact)) {
        hit = true;
        res.name.push(...nr);
      }
    }
  } else {
    if (!node.re) return null;
    const re = new RegExp(node.source, "gm" + (cs ? "" : "i"));
    const scan = (text: string, offset: number, out: Range[]) => {
      let found = false;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        out.push([offset + m.index, offset + m.index + m[0].length]);
        found = true;
      }
      return found;
    };
    hit = scan(scope.text, scope.offset, ranges);
    report(scope, ranges, res);
    if (scope.whole && scope.target === "content") {
      const nr: Range[] = [];
      if (scan(scope.doc.name, 0, nr)) {
        hit = true;
        res.name.push(...nr);
      }
    }
  }
  return hit ? res : null;
}

function normTag(t: string): string {
  return t.replace(/^#/, "").toLowerCase();
}

export function tagMatches(tag: string, query: string): boolean {
  const t = normTag(tag);
  const q = normTag(query);
  return t === q || t.startsWith(q + "/");
}

function frontmatterRange(doc: SearchDoc): [number, number] | null {
  const s = doc.meta?.sections?.[0];
  if (s && s.type === "yaml") return [s.position.start.offset, s.position.end.offset];
  if (doc.content.startsWith("---")) {
    const end = doc.content.indexOf("\n---", 3);
    if (end > 0) return [0, end + 4];
  }
  return null;
}

function evalTag(child: QueryNode, scope: Scope, cs: boolean): MatchResult | null {
  const q = child.type === "term" ? child.text : child.type === "all" ? "" : null;
  if (q === null || !q.replace(/^#/, "")) {
    if (child.type === "or") {
      const res = empty();
      let hit = false;
      for (const c of child.children) {
        const r = evalTag(c, scope, cs);
        if (r) {
          hit = true;
          merge(res, r);
        }
      }
      return hit ? res : null;
    }
    return null;
  }
  const meta = scope.doc.meta;
  const res = empty();
  let hit = false;
  const lo = scope.offset;
  const hi = scope.offset + scope.text.length;
  for (const t of meta?.tags ?? []) {
    const o = t.position.start.offset;
    if (o < lo || o >= hi) continue;
    if (tagMatches(t.tag, q)) {
      hit = true;
      res.content.push([o, t.position.end.offset]);
    }
  }
  if (scope.whole) {
    const fm = meta?.frontmatter;
    const raw = fm ? fm.tags ?? fm.tag : null;
    const list: string[] = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/[,\s]+/).filter(Boolean) : [];
    const matched = list.filter((t) => tagMatches(t, q));
    if (matched.length) {
      hit = true;
      const fr = frontmatterRange(scope.doc);
      if (fr) {
        const region = scope.doc.lower.slice(fr[0], fr[1]);
        for (const m of matched) findAll(region, m.replace(/^#/, "").toLowerCase(), fr[0], res.content);
      }
    }
  }
  return hit ? res : null;
}

interface Segment {
  start: number;
  end: number;
}

function lineSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let s = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text.charCodeAt(i) === 10) {
      out.push({ start: s, end: i });
      s = i + 1;
    }
  }
  return out;
}

function blockSegments(doc: SearchDoc): Segment[] {
  const meta = doc.meta;
  if (!meta?.sections?.length) {
    // Paragraphs separated by blank lines.
    const out: Segment[] = [];
    const re = /\n\s*\n/g;
    let s = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(doc.content))) {
      out.push({ start: s, end: m.index });
      s = m.index + m[0].length;
    }
    out.push({ start: s, end: doc.content.length });
    return out;
  }
  const out: Segment[] = [];
  for (const sec of meta.sections) {
    if (sec.type === "list" && meta.listItems) {
      const items = meta.listItems.filter((li) => li.position.start.offset >= sec.position.start.offset && li.position.end.offset <= sec.position.end.offset);
      if (items.length) {
        for (const li of items) out.push({ start: li.position.start.offset, end: li.position.end.offset });
        continue;
      }
    }
    out.push({ start: sec.position.start.offset, end: sec.position.end.offset });
  }
  return out;
}

function sectionSegments(doc: SearchDoc): Segment[] {
  const hs = doc.meta?.headings ?? [];
  if (!hs.length) return [{ start: 0, end: doc.content.length }];
  const out: Segment[] = [];
  if (hs[0].position.start.offset > 0) out.push({ start: 0, end: hs[0].position.start.offset });
  for (let i = 0; i < hs.length; i++) out.push({ start: hs[i].position.start.offset, end: i + 1 < hs.length ? hs[i + 1].position.start.offset : doc.content.length });
  return out;
}

function taskSegments(doc: SearchDoc, which: "task" | "task-todo" | "task-done"): Segment[] {
  const out: Segment[] = [];
  for (const li of doc.meta?.listItems ?? []) {
    if (li.task === undefined) continue;
    if (which === "task-todo" && li.task !== " ") continue;
    if (which === "task-done" && li.task === " ") continue;
    const start = li.position.start.offset;
    const nl = doc.content.indexOf("\n", start);
    out.push({ start, end: nl < 0 ? doc.content.length : Math.min(nl, li.position.end.offset) });
  }
  return out;
}

function evalSegments(child: QueryNode, segs: Segment[], scope: Scope, cs: boolean): MatchResult | null {
  const res = empty();
  let hit = false;
  for (const s of segs) {
    if (s.start < scope.offset || s.end > scope.offset + scope.text.length) continue;
    const a = s.start - scope.offset;
    const b = s.end - scope.offset;
    const sub: Scope = { text: scope.text.slice(a, b), lower: scope.lower.slice(a, b), offset: s.start, target: "content", whole: false, doc: scope.doc };
    if (child.type === "all") {
      hit = true;
      res.content.push([s.start, s.end]);
      continue;
    }
    const r = evalNode(child, sub, cs);
    if (r) {
      hit = true;
      merge(res, r);
      if (!r.content.length) res.content.push([s.start, s.end]);
    }
  }
  return hit ? res : null;
}

function valueStrings(v: any): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.flatMap(valueStrings);
  if (typeof v === "object") return [JSON.stringify(v)];
  return [String(v)];
}

function isEmptyValue(v: any): boolean {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function compare(v: any, cmp: string, target: string): boolean {
  const vals = Array.isArray(v) ? v : [v];
  const tn = Number(target);
  return vals.some((x) => {
    let a: number;
    let b: number;
    if (typeof x === "number" && !Number.isNaN(tn)) {
      a = x;
      b = tn;
    } else if (!Number.isNaN(Number(x)) && !Number.isNaN(tn) && String(x).trim() !== "") {
      a = Number(x);
      b = tn;
    } else {
      const da = Date.parse(String(x));
      const db = Date.parse(target);
      if (Number.isNaN(da) || Number.isNaN(db)) {
        const c = String(x).localeCompare(target);
        a = c;
        b = 0;
      } else {
        a = da;
        b = db;
      }
    }
    return cmp === ">" ? a > b : cmp === "<" ? a < b : cmp === ">=" ? a >= b : a <= b;
  });
}

function evalProp(node: QueryNode & { type: "prop" }, scope: Scope, cs: boolean): MatchResult | null {
  if (!scope.whole) return null;
  const fm = scope.doc.meta?.frontmatter;
  if (!fm) return null;
  const res = empty();
  let hit = false;
  const fr = frontmatterRange(scope.doc);
  for (const key of Object.keys(fm)) {
    if (key === "position") continue;
    const keyScope: Scope = { text: key, lower: key.toLowerCase(), offset: 0, target: "none", whole: false, doc: scope.doc };
    if (node.key.type !== "all" && !evalNode(node.key, keyScope, false)) continue;
    const v = fm[key];
    let ok = false;
    let valueNeedles: string[] = [];
    if (!node.value) ok = true;
    else if (node.value.kind === "empty") ok = isEmptyValue(v);
    else if (node.value.kind === "bool") ok = v === node.value.value || String(v).toLowerCase() === String(node.value.value);
    else if (node.value.kind === "compare") ok = compare(v, node.value.cmp, node.value.value);
    else {
      const vn = node.value.node;
      for (const s of valueStrings(v)) {
        const vs: Scope = { text: s, lower: s.toLowerCase(), offset: 0, target: "none", whole: false, doc: scope.doc };
        if (vn.type === "all" || evalNode(vn, vs, cs)) {
          ok = true;
          valueNeedles.push(s);
        }
      }
    }
    if (!ok) continue;
    hit = true;
    // Highlight the property's line in the frontmatter.
    if (fr) {
      const region = scope.doc.content.slice(fr[0], fr[1]);
      const m = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:.*$`, "m").exec(region);
      if (m) {
        const lineStart = fr[0] + m.index;
        const line = m[0];
        let marked = false;
        valueNeedles = valueNeedles.filter(Boolean);
        for (const vnd of valueNeedles) {
          const i = line.toLowerCase().indexOf(vnd.toLowerCase(), key.length);
          if (i >= 0) {
            res.content.push([lineStart + i, lineStart + i + vnd.length]);
            marked = true;
          }
        }
        if (!marked) res.content.push([lineStart, lineStart + key.length]);
      }
    }
  }
  return hit ? res : null;
}

export function evalNode(node: QueryNode, scope: Scope, cs: boolean): MatchResult | null {
  switch (node.type) {
    case "term":
    case "regex":
      return evalTextual(node, scope, cs);
    case "all":
      return empty();
    case "and": {
      const res = empty();
      for (const c of node.children) {
        const r = evalNode(c, scope, cs);
        if (!r) return null;
        merge(res, r);
      }
      return res;
    }
    case "or": {
      const res = empty();
      let hit = false;
      for (const c of node.children) {
        const r = evalNode(c, scope, cs);
        if (r) {
          hit = true;
          merge(res, r);
        }
      }
      return hit ? res : null;
    }
    case "not":
      return evalNode(node.child, scope, cs) ? null : empty();
    case "case":
      return evalNode(node.child, scope, node.sensitive);
    case "prop":
      return evalProp(node, scope, cs);
    case "op": {
      const doc = scope.doc;
      switch (node.op) {
        case "file": {
          if (!scope.whole) return null;
          const sub: Scope = { text: doc.name, lower: doc.name.toLowerCase(), offset: 0, target: "name", whole: false, doc };
          return node.child.type === "all" ? empty() : evalNode(node.child, sub, cs);
        }
        case "path": {
          if (!scope.whole) return null;
          const sub: Scope = { text: doc.path, lower: doc.path.toLowerCase(), offset: 0, target: "path", whole: false, doc };
          return node.child.type === "all" ? empty() : evalNode(node.child, sub, cs);
        }
        case "content": {
          const sub: Scope = { ...scope, whole: false };
          return node.child.type === "all" ? empty() : evalNode(node.child, sub, cs);
        }
        case "tag":
          return evalTag(node.child, scope, cs);
        case "line":
          return evalSegments(node.child, lineSegments(scope.text).map((s) => ({ start: s.start + scope.offset, end: s.end + scope.offset })), scope, cs);
        case "block":
          return evalSegments(node.child, blockSegments(doc), scope, cs);
        case "section":
          return evalSegments(node.child, sectionSegments(doc), scope, cs);
        case "task":
        case "task-todo":
        case "task-done":
          return evalSegments(node.child, taskSegments(doc, node.op), scope, cs);
        default:
          return null;
      }
    }
  }
}

/** Match one document. Returns null when it doesn't match; ranges are sorted and merged. */
export function matchDoc(node: QueryNode, doc: SearchDoc, caseSensitive = false): MatchResult | null {
  const scope: Scope = { text: doc.content, lower: doc.lower, offset: 0, target: "content", whole: true, doc };
  const r = evalNode(node, scope, caseSensitive);
  if (!r) return null;
  return { content: normalizeRanges(r.content), name: normalizeRanges(r.name), path: normalizeRanges(r.path) };
}

export function normalizeRanges(rs: Range[]): Range[] {
  if (rs.length < 2) return rs.slice();
  const s = rs.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Range[] = [s[0].slice() as Range];
  for (let i = 1; i < s.length; i++) {
    const last = out[out.length - 1];
    if (s[i][0] <= last[1]) last[1] = Math.max(last[1], s[i][1]);
    else out.push(s[i].slice() as Range);
  }
  return out;
}

/** Does the query need file contents at all? (file:/path:-only queries don't.) */
export function needsContent(node: QueryNode): boolean {
  switch (node.type) {
    case "op":
      return node.op === "file" || node.op === "path" ? false : true;
    case "and":
    case "or":
      return node.children.some(needsContent);
    case "not":
    case "case":
      return needsContent(node.child);
    case "prop":
      return false;
    default:
      return true;
  }
}

/** Quick pre-filter: a lower-case string that must appear in the content or name of every match, or null. */
export function requiredNeedle(node: QueryNode): string | null {
  if (node.type === "term" && !node.exact) return node.text.toLowerCase();
  if (node.type === "term") return node.text.toLowerCase();
  if (node.type === "and") {
    let best: string | null = null;
    for (const c of node.children) {
      const n = requiredNeedle(c);
      if (n && (!best || n.length > best.length)) best = n;
    }
    return best;
  }
  return null;
}

// ---------------------------------------------------------------- explain
export interface ExplainLine {
  text: string;
  children: ExplainLine[];
}

const OP_INFO: Record<string, string> = {
  file: "Match file name:",
  path: "Match file path:",
  content: "Match file content:",
  line: "Match line:",
  block: "Match block:",
  section: "Match section:",
  task: "Match task:",
  "task-todo": "Match unfinished task:",
  "task-done": "Match completed task:",
};

export function explain(node: QueryNode): ExplainLine {
  const L = (text: string, children: ExplainLine[] = []): ExplainLine => ({ text, children });
  switch (node.type) {
    case "and":
      return L("Match all of:", node.children.map(explain));
    case "or":
      return L("Match any of:", node.children.map(explain));
    case "not":
      return L("Excluding:", [explain(node.child)]);
    case "term":
      return L(node.exact ? `Contains exact text: "${node.text}"` : `Matches text: "${node.text}"`);
    case "regex":
      return L(node.re ? `Matches regular expression: /${node.source}/` : `Invalid regular expression: /${node.source}/`);
    case "all":
      return L('Matches text: ""');
    case "case":
      return L(node.sensitive ? "Case sensitive" : "Case insensitive", [explain(node.child)]);
    case "prop": {
      const kids = [L("Key:", [explain(node.key)])];
      if (node.value) {
        const v = node.value;
        const vl =
          v.kind === "query"
            ? explain(v.node)
            : v.kind === "empty"
              ? L("Is empty")
              : v.kind === "bool"
                ? L(v.value ? "Is true" : "Is false")
                : L(`${v.cmp === ">" ? "Greater than" : v.cmp === "<" ? "Less than" : v.cmp === ">=" ? "Greater than or equal to" : "Less than or equal to"}: ${v.value}`);
        kids.push(L("Value:", [vl]));
      }
      return L("Contains property:", kids);
    }
    case "op":
      if (node.op === "tag") return L(`Match tag: #${node.child.type === "term" ? node.child.text.replace(/^#/, "") : ""}`);
      return L(OP_INFO[node.op] ?? node.op, [explain(node.child)]);
  }
}
