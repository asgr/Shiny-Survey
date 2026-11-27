const CFG = { owner: "x", privateRepo: "r", workerUrl: "https://w" };
document.getElementById = () => null;
document.createElementNS = (ns, t) => new Node(t);
function assert(n, c, extra) { print((c?"PASS ":"FAIL ")+n+(c?"":" -- "+extra)); if(!c) throw new Error(n); }
function findTag(n, tag, out=[]) { if (n.tag === tag) out.push(n); (n.children||[]).forEach(c=>findTag(c,tag,out)); return out; }
function titlesOf(svg) { return findTag(svg, "title").map(t => t.children.map(c => c.text || "").join("")); }
// choice chart with names
const q = { id: "qs", type: "single", label: "Pick", options: ["a","b"] };
const rs = [
  { name: "Alice", answers: { qs: "a" } },
  { name: null, answers: { qs: "a" } },
  { name: "Bob", answers: { qs: "b" } },
];
const box = choiceSummary(q, rs);
const svg = findTag(box, "svg")[0];
const titles = titlesOf(svg);
assert("option a names", titles.some(t => t.includes("a: 2") && t.includes("Alice") && t.includes("(anonymous)")), JSON.stringify(titles));
assert("option b names", titles.some(t => t.includes("b: 1") && t.includes("Bob")));
// meeting stacked bars with names
const qm = { id: "qm", type: "meeting", label: "W",
  slots: ["Mon Dec 7, 10:00\u201311:00"],
  slotCells: { "Mon Dec 7, 10:00\u201311:00": ["2026-12-07T02:00:00.000Z","2026-12-07T02:30:00.000Z"] } };
const rm = [
  { name: "Cara", answers: { qm: { "Mon Dec 7, 10:00\u201311:00": "yes" } } },
  { name: "Dan", answers: { qm: { "Mon Dec 7, 10:00\u201311:00": "no" } } },
];
const mbox = meetingSummary(qm, rm, { createdAt: "2026-11-26T00:00:00Z", questions: [qm] });
const msvg = findTag(mbox, "svg")[0];
const mt = titlesOf(msvg);
assert("available segment names", mt.some(t => t.includes("available: 1") && t.includes("Cara")), JSON.stringify(mt));
assert("not-available segment names", mt.some(t => t.includes("not available: 1") && t.includes("Dan")));
// no names -> no suffix junk
const anon = choiceSummary(q, [{ name: null, answers: { qs: "a" } }]);
const at = titlesOf(findTag(anon, "svg")[0]);
assert("anon label used", at.some(t => t.includes("(anonymous)")));
print("names tests OK");
