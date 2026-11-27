// Headless exercise of the real time-grid editor: build DOM, simulate
// pointer painting, and emit the survey JSON the designer would publish.

// ---- minimal DOM stub ----
class ClassList {
  constructor(node) { this.node = node; }
  _set() { return new Set((this.node.attrs.class || "").split(/\s+/).filter(Boolean)); }
  add(c) { const s = this._set(); s.add(c); this.node.attrs.class = [...s].join(" "); }
  remove(c) { const s = this._set(); s.delete(c); this.node.attrs.class = [...s].join(" "); }
  contains(c) { return this._set().has(c); }
}
class Node {
  constructor(tag) {
    this.tag = tag; this.nodeType = 1; this.attrs = {}; this.children = []; this.listeners = {};
    this.style = {}; this.classList = new ClassList(this); this.textContent = "";
  }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === "value") this.value = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  append(...cs) { for (const c of cs.flat()) { c.parent = this; this.children.push(c); } }
  replaceChildren(...cs) { this.children = []; this.append(...cs); }
  contains(n) { while (n) { if (n === this) return true; n = n.parent; } return false; }
  closest(cls) {
    const c = cls.replace(/^\./, "");
    let n = this;
    while (n) { if (n.classList && n.classList.contains(c)) return n; n = n.parent; }
    return null;
  }
  fire(t, e) { (this.listeners[t] || []).forEach((fn) => fn(e)); }
  allCells() {
    const out = [];
    const walk = (n) => { if (!n.classList) return; if (n.classList.contains("tg-cell")) out.push(n); n.children.forEach(walk); };
    walk(this);
    return out;
  }
}
const document = {
  createElement: (t) => new Node(t),
  createTextNode: (s) => ({ text: s, nodeType: 3 }),
  elementFromPoint: () => document._hover || null,
  _hover: null,
};
const window = {
  listeners: {},
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
  fire(t, e) { (this.listeners[t] || []).forEach((fn) => fn(e)); },
  scrollTo() {},
};
const location = { href: "https://asgr.github.io/Shiny-Survey/index.html" };
const localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

// el() helper copied from docs/assets/common.js behavior
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v, node.setAttribute("class", v);
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

// ---- load real editor code (concatenated below) ----
