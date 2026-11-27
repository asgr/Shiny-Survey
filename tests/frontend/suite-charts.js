// add createElementNS to the DOM stub
document.createElementNS = (ns, t) => new Node(t);
function tallyTable(rows, headers) {
  const table = el("table", { class: "grid" });
  table.append(el("tr", {}, headers.map((h) => el("th", {}, h))));
  for (const r of rows) table.append(el("tr", {}, r.map((c) => el("td", {}, String(c)))));
  return table;
}
function assert(n, c, extra) { print((c?"PASS ":"FAIL ")+n+(c?"":" -- "+extra)); if(!c) throw new Error(n); }
function findTag(n, tag, out=[]) { if (n.tag === tag) out.push(n); (n.children||[]).forEach(c=>findTag(c,tag,out)); return out; }

const items = [{label:"A", value:3},{label:"B", value:1},{label:"C", value:0}];
const svg = hbarChart(items, {max: 4});
const rects = findTag(svg, "rect");
assert("bg+bar per item", rects.length === 6, rects.length);
// bar widths proportional: A=3/4 of plot, B=1/4
const bars = rects.filter((r,i) => i % 2 === 1);
assert("proportional widths", Math.abs(Number(bars[0].attrs.width) / Number(bars[1].attrs.width) - 3) < 1e-9);
assert("zero value zero width", Number(bars[2].attrs.width) === 0);
const texts = findTag(svg, "text").map(t => t.children.map(c=>c.text||"").join(""));
assert("value labels", texts.includes("3") && texts.includes("1") && texts.includes("0"));

const st = stackedBarChart([{label:"Mon", parts:[{value:2,color:"#22a06b",name:"available"},{value:1,color:"#d5dbe2",name:"not"}]}], {max:3});
const stRects = findTag(st, "rect");
assert("stack bg + 2 segments", stRects.length === 3, stRects.length);
assert("segments adjacent", Number(stRects[1].attrs.x) + Number(stRects[1].attrs.width) === Number(stRects[2].attrs.x));

// long labels truncated
const long = hbarChart([{label:"X".repeat(50), value:1}]);
const lt = findTag(long, "text")[0].children.map(c=>c.text||"").join("");
assert("label truncated", lt.length === 34 && lt.endsWith("\u2026"), lt.length);

// responses over time
const rs = [
  {submittedAt:"2026-11-24T10:00:00Z"},{submittedAt:"2026-11-24T12:00:00Z"},
  {submittedAt:"2026-11-25T09:00:00Z"},
];
const ot = responsesOverTime(rs);
assert("over-time built", ot !== null);
const otTables = findTag(ot, "table");
assert("over-time has table", otTables.length === 1);
assert("single day -> null", responsesOverTime([{submittedAt:"2026-11-24T10:00:00Z"},{submittedAt:"2026-11-24T11:00:00Z"}]) === null);
assert("empty chart message", hbarChart([]).tag === "p");
print("charts tests OK");
