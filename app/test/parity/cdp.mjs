// Tiny Chrome DevTools Protocol client (Node 22 global WebSocket) used by the editor parity
// harness to drive two Electron apps the same way: real key events in, editor state out.
export async function listTargets(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json`);
  return r.json();
}

export async function waitForPort(port, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const t = await listTargets(port);
      if (t.some((x) => x.type === "page")) return t;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`CDP port ${port} did not come up`);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect(port, pick = (pages) => pages[0]) {
  const pages = (await listTargets(port)).filter((t) => t.type === "page");
  const target = pick(pages);
  if (!target) throw new Error("no page target on port " + port);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.rej(new Error(JSON.stringify(m.error)));
      else p.res(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error("page error: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
    return r.result.value;
  };
  const screenshot = async (clip) => {
    const p = { format: "png" };
    if (clip) p.clip = { ...clip, scale: 1 };
    const r = await send("Page.captureScreenshot", p);
    return Buffer.from(r.data, "base64");
  };
  return { target, send, evaluate, screenshot, close: () => ws.close() };
}

// ---- keys ----
const NAMED = {
  Enter: { code: "Enter", vk: 13, text: "\r" },
  Tab: { code: "Tab", vk: 9 },
  Backspace: { code: "Backspace", vk: 8 },
  Delete: { code: "Delete", vk: 46 },
  Escape: { code: "Escape", vk: 27 },
  ArrowUp: { code: "ArrowUp", vk: 38 },
  ArrowDown: { code: "ArrowDown", vk: 40 },
  ArrowLeft: { code: "ArrowLeft", vk: 37 },
  ArrowRight: { code: "ArrowRight", vk: 39 },
  Home: { code: "Home", vk: 36 },
  End: { code: "End", vk: 35 },
  PageUp: { code: "PageUp", vk: 33 },
  PageDown: { code: "PageDown", vk: 34 },
  Space: { code: "Space", vk: 32, key: " ", text: " " },
};
const PUNCT = {
  "/": ["Slash", 191], ";": ["Semicolon", 186], ",": ["Comma", 188], ".": ["Period", 190], "[": ["BracketLeft", 219], "]": ["BracketRight", 221],
  "=": ["Equal", 187], "-": ["Minus", 189], "`": ["Backquote", 192], "'": ["Quote", 222], "\\": ["Backslash", 220],
};
const MOD_BITS = { Alt: 1, Ctrl: 2, Meta: 4, Shift: 8 };

function describeKey(k) {
  if (NAMED[k]) return { key: NAMED[k].key ?? k, ...NAMED[k] };
  if (/^[a-zA-Z]$/.test(k)) return { key: k, code: "Key" + k.toUpperCase(), vk: k.toUpperCase().charCodeAt(0), text: k };
  if (/^[0-9]$/.test(k)) return { key: k, code: "Digit" + k, vk: k.charCodeAt(0), text: k };
  if (/^F\d+$/.test(k)) return { key: k, code: k, vk: 111 + Number(k.slice(1)) };
  if (PUNCT[k]) return { key: k, code: PUNCT[k][0], vk: PUNCT[k][1], text: k };
  return { key: k, code: "", vk: 0, text: k };
}

/** Press a chord like "Ctrl+Shift+ArrowUp", "Enter", "Tab". */
export async function press(c, chord) {
  const parts = chord.split("+").filter(Boolean);
  const keyName = parts.length > 1 && parts[parts.length - 1] === "" ? "+" : parts.pop();
  let modifiers = 0;
  for (const p of parts) modifiers |= MOD_BITS[p] ?? 0;
  const d = describeKey(keyName);
  let key = d.key;
  if (modifiers & MOD_BITS.Shift && /^[a-z]$/.test(key)) key = key.toUpperCase();
  // Text only for unmodified (or shift-only) printable keys, like a real keyboard.
  const text = modifiers & (MOD_BITS.Ctrl | MOD_BITS.Alt | MOD_BITS.Meta) ? undefined : d.text && (modifiers & MOD_BITS.Shift && /^[a-z]$/.test(d.text) ? d.text.toUpperCase() : d.text);
  const base = { modifiers, key, code: d.code, windowsVirtualKeyCode: d.vk, nativeVirtualKeyCode: d.vk };
  await c.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, text, unmodifiedText: text });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

/** Type text one character at a time as key presses (so input handlers see each char). */
export async function typeText(c, text) {
  for (const ch of text) {
    if (ch === "\n") {
      await press(c, "Enter");
      continue;
    }
    const d = describeKey(ch);
    const base = { modifiers: 0, key: ch, code: d.code, windowsVirtualKeyCode: d.vk, nativeVirtualKeyCode: d.vk };
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, text: ch, unmodifiedText: ch });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  }
}
