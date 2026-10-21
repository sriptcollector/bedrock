// A small search-query matcher for the graph filter and colour groups. It understands the common
// parts of the search syntax: words (all must match), "exact phrases", -exclusions, OR, ( ),
// /regex/ and the file:, path:, tag:, content:, line:, block:, section:, match-case: and
// ignore-case: operators. Bare words match the file name or the contents.

export interface QueryTarget {
  path: string;
  /** File name with extension. */
  name: string;
  tags: string[];
  /** Note contents, or null when not loaded (content terms then don't match). */
  content: string | null;
}

type Field = "any" | "file" | "path" | "tag" | "content";

type Node =
  | { kind: "and"; items: Node[] }
  | { kind: "or"; items: Node[] }
  | { kind: "not"; item: Node }
  | { kind: "term"; field: Field; text: string; regex: RegExp | null; caseSensitive: boolean };

const OPERATORS: Record<string, Field> = {
  file: "file",
  path: "path",
  tag: "tag",
  content: "content",
  line: "content",
  block: "content",
  section: "content",
  "task": "content",
  "task-todo": "content",
  "task-done": "content",
};

interface Token {
  t: "word" | "lp" | "rp" | "or";
  text?: string;
  quoted?: boolean;
  regex?: boolean;
  neg?: boolean;
  op?: string;
}

function tokenize(q: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    let neg = false;
    if (c === "-" && i + 1 < q.length && !/\s/.test(q[i + 1])) {
      neg = true;
      i++;
    }
    if (q[i] === "(") {
      out.push({ t: "lp", neg });
      i++;
      continue;
    }
    if (q[i] === ")") {
      out.push({ t: "rp" });
      i++;
      continue;
    }
    // operator prefix
    let op: string | undefined;
    const m = /^([a-z-]+):/.exec(q.slice(i));
    if (m && (OPERATORS[m[1]] || m[1] === "match-case" || m[1] === "ignore-case")) {
      op = m[1];
      i += m[0].length;
      if (q[i] === "(") {
        // operator applied to a group: expand as op on each word inside
        let depth = 0;
        let j = i;
        for (; j < q.length; j++) {
          if (q[j] === "(") depth++;
          else if (q[j] === ")" && --depth === 0) break;
        }
        const inner = tokenize(q.slice(i + 1, j));
        out.push({ t: "lp", neg });
        for (const tk of inner) out.push(tk.t === "word" && !tk.op ? { ...tk, op } : tk);
        out.push({ t: "rp" });
        i = j + 1;
        continue;
      }
    }
    if (q[i] === '"') {
      let j = i + 1;
      let s = "";
      while (j < q.length && q[j] !== '"') {
        if (q[j] === "\\" && j + 1 < q.length) j++;
        s += q[j++];
      }
      out.push({ t: "word", text: s, quoted: true, neg, op });
      i = j + 1;
      continue;
    }
    if (q[i] === "/") {
      let j = i + 1;
      let s = "";
      while (j < q.length && q[j] !== "/") {
        if (q[j] === "\\" && q[j + 1] === "/") {
          s += "/";
          j += 2;
          continue;
        }
        s += q[j++];
      }
      if (j < q.length) {
        out.push({ t: "word", text: s, regex: true, neg, op });
        i = j + 1;
        continue;
      }
    }
    let j = i;
    while (j < q.length && !/[\s()]/.test(q[j])) j++;
    const word = q.slice(i, j);
    i = j;
    if (!word && !op) continue;
    if (word === "OR" && !neg && !op) out.push({ t: "or" });
    else out.push({ t: "word", text: word, neg, op });
  }
  return out;
}

function parse(tokens: Token[]): Node {
  let pos = 0;
  let caseSensitive = false;
  const parseOr = (): Node => {
    const items: Node[] = [parseAnd()];
    while (tokens[pos]?.t === "or") {
      pos++;
      items.push(parseAnd());
    }
    return items.length === 1 ? items[0] : { kind: "or", items };
  };
  const parseAnd = (): Node => {
    const items: Node[] = [];
    while (pos < tokens.length && tokens[pos].t !== "rp" && tokens[pos].t !== "or") {
      const tk = tokens[pos++];
      if (tk.t === "lp") {
        const inner = parseOr();
        if (tokens[pos]?.t === "rp") pos++;
        items.push(tk.neg ? { kind: "not", item: inner } : inner);
        continue;
      }
      if (tk.op === "match-case" || tk.op === "ignore-case") {
        caseSensitive = tk.op === "match-case";
        if (!tk.text) continue;
      }
      const field: Field = tk.op ? OPERATORS[tk.op] ?? "any" : "any";
      let text = tk.text ?? "";
      if (field === "tag") text = text.replace(/^#/, "");
      if (!text) continue;
      let regex: RegExp | null = null;
      if (tk.regex) {
        try {
          regex = new RegExp(text, caseSensitive ? "" : "i");
        } catch {
          regex = null;
        }
      }
      const term: Node = { kind: "term", field, text, regex, caseSensitive };
      items.push(tk.neg ? { kind: "not", item: term } : term);
    }
    return items.length === 1 ? items[0] : { kind: "and", items };
  };
  return parseOr();
}

function includes(hay: string, needle: string, cs: boolean): boolean {
  return cs ? hay.includes(needle) : hay.toLowerCase().includes(needle.toLowerCase());
}

function matchText(term: Extract<Node, { kind: "term" }>, hay: string): boolean {
  if (term.regex) return term.regex.test(hay);
  return includes(hay, term.text, term.caseSensitive);
}

function matchTag(term: Extract<Node, { kind: "term" }>, tags: string[]): boolean {
  const want = term.text.toLowerCase();
  return tags.some((t) => {
    const tag = t.replace(/^#/, "").toLowerCase();
    return term.regex ? term.regex.test(tag) : tag === want || tag.startsWith(want + "/");
  });
}

function evaluate(n: Node, t: QueryTarget): boolean {
  switch (n.kind) {
    case "and":
      return n.items.every((i) => evaluate(i, t));
    case "or":
      return n.items.some((i) => evaluate(i, t));
    case "not":
      return !evaluate(n.item, t);
    case "term":
      switch (n.field) {
        case "file":
          return matchText(n, t.name);
        case "path":
          return matchText(n, t.path);
        case "tag":
          return matchTag(n, t.tags);
        case "content":
          return t.content !== null && matchText(n, t.content);
        default:
          return matchText(n, t.name) || (t.content !== null && matchText(n, t.content));
      }
  }
}

function needsContentNode(n: Node): boolean {
  switch (n.kind) {
    case "and":
    case "or":
      return n.items.some(needsContentNode);
    case "not":
      return needsContentNode(n.item);
    case "term":
      return n.field === "any" || n.field === "content";
  }
}

function isEmpty(n: Node): boolean {
  return (n.kind === "and" || n.kind === "or") && n.items.length === 0;
}

export class GraphQuery {
  readonly source: string;
  private root: Node;
  readonly needsContent: boolean;
  readonly empty: boolean;

  constructor(source: string) {
    this.source = source;
    this.root = parse(tokenize(source));
    this.empty = isEmpty(this.root);
    this.needsContent = !this.empty && needsContentNode(this.root);
  }

  match(t: QueryTarget): boolean {
    if (this.empty) return false;
    return evaluate(this.root, t);
  }

  /** Does the query match a tag node (`#tag`)? */
  matchTag(tag: string): boolean {
    const name = tag.replace(/^#/, "");
    return this.match({ path: tag, name, tags: [tag], content: null });
  }

  /** Does the query match a file that has no contents to search (attachments, unresolved)? */
  matchFilename(path: string): boolean {
    return this.match({ path, name: path.split("/").pop() ?? path, tags: [], content: null });
  }
}
