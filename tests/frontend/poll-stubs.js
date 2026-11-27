function assert(n, c, extra) { print((c?"PASS ":"FAIL ")+n+(c?"":" -- "+extra)); if(!c) throw new Error(n); }
const CFG = { workerUrl: "https://w.example" };
let countVal = 5;
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls++; return { ok: true, json: async () => ({ total: countVal }) }; };
const document = { visibilityState: "visible" };
const listBox = { children: [] };
function $(id) { return listBox; }
// stub el minimal
function el(tag, attrs, ...kids) {
  return { tag, attrs, children: kids.flat().filter(x => x && typeof x === "object"),
    textContent: kids.filter(x => typeof x === "string").join(""),
    replaceChildren(...c) { this.children = c; }, append(...c) { this.children.push(...c); } };
}
let intervalFn = null;
function setInterval(fn, ms) { assert("60s interval", ms === 60000); intervalFn = fn; return 1; }
