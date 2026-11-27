function assert(n, c, extra) { print((c?"PASS ":"FAIL ")+n+(c?"":" -- "+extra)); if(!c) throw new Error(n); }
// 28-day organizer grid
const q = { id: "qw", type: "meeting", label: "W", required: true, slots: [],
  grid: { startDate: "2026-12-07", days: 28, startMin: 540, endMin: 600, step: 30, tz: "Australia/Perth", selected: [] } };
const editor = createTimeGridEditor(q, () => {});
const cells = editor.allCells();
assert("28 days x 2 rows", cells.length === 56, cells.length);
function findGrid(n) { if (n.classList && n.classList.contains("tg-grid")) return n; for (const c of n.children||[]) { const r = findGrid(c); if (r) return r; } return null; }
const g = findGrid(editor);
assert("min column width for wide grid", g.style.gridTemplateColumns.includes("minmax(64px"), g.style.gridTemplateColumns);

// list display: renderQuestion falls to table with default "no"
const ql = { id: "ql", type: "meeting", label: "L", required: true, display: "list",
  slots: ["Mon Dec 7, 10:00\u201311:00", "Fri Jan 15, 14:00\u201315:00"],
  slotCells: { "Mon Dec 7, 10:00\u201311:00": ["2026-12-07T02:00:00.000Z","2026-12-07T02:30:00.000Z"],
               "Fri Jan 15, 14:00\u201315:00": ["2027-01-15T06:00:00.000Z","2027-01-15T06:30:00.000Z"] } };
// stub querySelector on Node for the default-no logic
Node.prototype.querySelector = function(sel) {
  const m = sel.match(/input\[name="([^"]+)"\]\[value="([^"]+)"\]/);
  if (!m) return null;
  let found = null;
  (function walk(n) {
    if (found || !n.attrs) return;
    if (n.tag === "input" && n.attrs.name === m[1] && n.attrs.value === m[2]) { found = n; return; }
    (n.children || []).forEach(walk);
  })(this);
  return found;
};
const box = renderQuestion(ql, 0, { grid: true, refDate: new Date(2026, 10, 26) });
assert("list mode: no paint grid", !box._respondGrid);
function findTag(n, tag, out=[]) { if (n.tag === tag) out.push(n); (n.children||[]).forEach(c=>findTag(c,tag,out)); return out; }
const radios = findTag(box, "input").filter((i) => i.attrs.type === "radio");
assert("2 windows x 2 options", radios.length === 4, radios.length);
assert("default no checked", radios.filter((r) => r.checked && r.attrs.value === "no").length === 2);
// grid mode still builds a paint grid for same question
const qg = { ...ql, display: "grid" };
const boxG = renderQuestion(qg, 0, { grid: true, refDate: new Date(2026, 10, 26) });
assert("grid mode builds grid", !!boxG._respondGrid);
// preview (readOnly) list mode also table
const boxP = renderQuestion(ql, 0, { grid: true, readOnly: true, refDate: new Date() });
assert("preview list mode table", !boxP._respondGrid);
print("updates tests OK");
