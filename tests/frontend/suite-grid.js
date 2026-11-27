function assert(n, c, extra) { print((c?"PASS ":"FAIL ")+n+(c?"":" -- "+extra)); if(!c) throw new Error(n); }
const ref = new Date(2026, 10, 25);

// ---------- organizer: rectangle drag ----------
const q = { id: "qg", type: "meeting", label: "When", required: true, slots: [], choices: ["yes","no","maybe"],
  grid: { startDate: "2026-12-07", days: 3, startMin: 540, endMin: 720, step: 30, tz: "Australia/Perth", selected: [] } };
const editor = createTimeGridEditor(q, () => {});
const cells = editor.allCells();
const byRC = (r, c) => cells.find((x) => x.getAttribute("data-row") === String(r) && x.getAttribute("data-col") === String(c));
const gridEl = cells[0].parent;
function drag(r0, c0, r1, c1) {
  gridEl.fire("pointerdown", { target: byRC(r0, c0), preventDefault() {} });
  document._hover = byRC(r1, c1);
  gridEl.fire("pointermove", { clientX: 0, clientY: 0 });
  window.fire("pointerup", {});
}
// Diagonal drag Mon(600) -> Tue(660): rectangle covers BOTH days, rows 600-660
drag(600, 0, 660, 1);
assert("rect covers 6 cells", q.grid.selected.length === 6, JSON.stringify(q.grid.selected));
assert("two merged slots", q.slots.length === 2, JSON.stringify(q.slots));
assert("Mon slot", q.slots[0] === "Mon Dec 7, 10:00\u201311:30", q.slots[0]);
assert("Tue slot", q.slots[1] === "Tue Dec 8, 10:00\u201311:30", q.slots[1]);
// slotCells: 3 UTC instants per slot, Perth 10:00 = 02:00Z
assert("slotCells Mon", JSON.stringify(q.slotCells[q.slots[0]]) ===
  JSON.stringify(["2026-12-07T02:00:00.000Z","2026-12-07T02:30:00.000Z","2026-12-07T03:00:00.000Z"]), JSON.stringify(q.slotCells));
// click single selected cell to deselect -> Mon slot splits
drag(630, 0, 630, 0);
assert("click deselects one", q.grid.selected.length === 5);
assert("Mon split into two", q.slots.length === 3, JSON.stringify(q.slots));
assert("Mon first half", q.slots[0] === "Mon Dec 7, 10:00\u201310:30");
assert("Mon second half", q.slots[1] === "Mon Dec 7, 11:00\u201311:30");
// click empty cell selects just it
drag(540, 2, 540, 2);
assert("single click select", q.grid.selected.length === 6);
// drag starting on selected cell ERASES the rect
drag(600, 0, 660, 1);
assert("erase rect", q.grid.selected.length === 1 && q.grid.selected[0] === "2026-12-09|540", JSON.stringify(q.grid.selected));

// ---------- respondent: cell-level painting ----------
const sq = {
  id: "qr", type: "meeting", label: "When", required: true,
  slots: ["Mon Dec 7, 10:00\u201311:30", "Wed Dec 9, 09:00\u201310:00"],
  tz: "Australia/Perth",
  slotCells: {
    "Mon Dec 7, 10:00\u201311:30": ["2026-12-07T02:00:00.000Z","2026-12-07T02:30:00.000Z","2026-12-07T03:00:00.000Z"],
    "Wed Dec 9, 09:00\u201310:00": ["2026-12-09T01:00:00.000Z","2026-12-09T01:30:00.000Z"],
  },
};
const rg = createRespondentGrid(sq, ref);
assert("rg built", rg !== null);
const rCells = rg.element.allCells();
const rByRC = (r, c) => rCells.find((x) => x.getAttribute("data-row") === String(r) && x.getAttribute("data-col") === String(c));
const rGrid = rCells[0].parent;
function rdrag(r0, c0, r1, c1) {
  rGrid.fire("pointerdown", { target: rByRC(r0, c0), preventDefault() {} });
  document._hover = rByRC(r1, c1);
  rGrid.fire("pointermove", { clientX: 0, clientY: 0 });
  window.fire("pointerup", {});
}
// local zone Perth: dates Dec 7 & Dec 9; rows window 8:30..11:30 (pad).
// row indices are global: Dec7=day0, Dec9=day1 (dates list only has 2 entries!)
// find actual rows from allowed cells:
const allowed = rCells.filter((c) => c.classList.contains("allowed"));
assert("5 allowed", allowed.length === 5, allowed.length);
const monCells = allowed.filter((c) => c.getAttribute("data-slot") === null || true)
  .filter((c) => Number(c.getAttribute("data-ts")) >= Date.parse("2026-12-07T02:00:00.000Z") &&
                Number(c.getAttribute("data-ts")) <= Date.parse("2026-12-07T03:00:00.000Z"));
assert("3 Mon cells", monCells.length === 3);
// CLICK middle Mon cell -> toggles ONE cell (binary: any = yes, with parts)
const mid = monCells[1];
const first = monCells[0], last = monCells[2];
rdrag(Number(mid.getAttribute("data-row")), Number(mid.getAttribute("data-col")),
      Number(mid.getAttribute("data-row")), Number(mid.getAttribute("data-col")));
let a = rg.getAnswers();
assert("click selects one cell", a[sq.slots[0]] === "yes", JSON.stringify(a));
assert("only ONE cell green", rCells.filter((c) => c.classList.contains("chosen")).length === 1);
assert("parts = just mid", JSON.stringify(a[sq.slots[0] + " (parts)"]) === JSON.stringify(["2026-12-07T02:30:00.000Z"]));
assert("Wed untouched = no", a[sq.slots[1]] === "no");
// click again -> that cell off, window back to no
rdrag(Number(mid.getAttribute("data-row")), Number(mid.getAttribute("data-col")),
      Number(mid.getAttribute("data-row")), Number(mid.getAttribute("data-col")));
a = rg.getAnswers();
assert("click again deselects cell", a[sq.slots[0]] === "no");
// DRAG over just the middle cell (down on first, move to mid, up) -> partial
// use down on mid then move to last: covers mid+last = 2 of 3 cells
rGrid.fire("pointerdown", { target: mid, preventDefault() {} });
document._hover = last;
rGrid.fire("pointermove", { clientX: 0, clientY: 0 });
window.fire("pointerup", {});
a = rg.getAnswers();
assert("drag partial = yes (binary)", a[sq.slots[0]] === "yes", JSON.stringify(a));
assert("parts recorded", JSON.stringify(a[sq.slots[0] + " (parts)"]) ===
  JSON.stringify(["2026-12-07T02:30:00.000Z","2026-12-07T03:00:00.000Z"]));
// drag from first across all -> full yes
rdrag(Number(first.getAttribute("data-row")), Number(first.getAttribute("data-col")),
      Number(last.getAttribute("data-row")), Number(last.getAttribute("data-col")));
a = rg.getAnswers();
assert("full = yes", a[sq.slots[0]] === "yes");
assert("no parts when full", a[sq.slots[0] + " (parts)"] === undefined);
// erase-rect: drag from a chosen Mon cell down across all Mon rows
const wedCells = allowed.filter((c) => Number(c.getAttribute("data-ts")) >= Date.parse("2026-12-09T01:00:00.000Z"));
rdrag(Number(first.getAttribute("data-row")), Number(first.getAttribute("data-col")),
      Number(last.getAttribute("data-row")), Number(last.getAttribute("data-col")));
a = rg.getAnswers();
assert("erase rect clears Mon", a[sq.slots[0]] === "no", JSON.stringify(a));
// rect covering ALL allowed cells x both cols selects both; anchor on an
// UNSELECTED cell so the drag is in select mode
const allRows = allowed.map((c) => Number(c.getAttribute("data-row")));
const rMin = Math.min(...allRows), rMax = Math.max(...allRows);
const blank = rCells.find((c) => !c.classList.contains("allowed") &&
  Number(c.getAttribute("data-row")) === rMin && c.getAttribute("data-col") === "0");
rdrag(rMin, Number(blank.getAttribute("data-col")), rMax, 1);
a = rg.getAnswers();
assert("select rect both yes", a[sq.slots[0]] === "yes" && a[sq.slots[1]] === "yes", JSON.stringify(a));

// zone switch preserves cell-level selection
function findSelects(n, out=[]) { if (n.tag === "select") out.push(n); (n.children||[]).forEach(c=>findSelects(c,out)); return out; }
const sel = findSelects(rg.element)[0];
// drag-erase the middle Mon cell (down on mid=chosen -> erase mode, move to
// last then back to mid would erase both; instead erase via rect mid..last,
// then re-add last by drag from blank? simpler: erase mid..last, keep first)
rGrid.fire("pointerdown", { target: mid, preventDefault() {} });
document._hover = last;
rGrid.fire("pointermove", { clientX: 0, clientY: 0 });
window.fire("pointerup", {});
// now only first Mon cell chosen -> partial [02:00]
sel.value = "America/New_York";
sel.fire("change");
a = rg.getAnswers();
assert("partial survives zone switch", a[sq.slots[0]] === "yes" && a[sq.slots[1]] === "yes", JSON.stringify(a));
assert("parts survive zone switch", JSON.stringify(a[sq.slots[0] + " (parts)"]) ===
  JSON.stringify(["2026-12-07T02:00:00.000Z"]));

// legacy fallbacks still work
const legacy = { ...sq, slotCells: undefined, slotTimes: {
  "Mon Dec 7, 10:00\u201311:30": { start: "2026-12-07T02:00:00.000Z", end: "2026-12-07T03:30:00.000Z" },
  "Wed Dec 9, 09:00\u201310:00": { start: "2026-12-09T01:00:00.000Z", end: "2026-12-09T02:00:00.000Z" } } };
const rgLegacy = createRespondentGrid(legacy, ref);
assert("slotTimes fallback builds", rgLegacy !== null);
assert("hand-typed still null", createRespondentGrid({ slots: ["Mon 25th Nov 10-11"] }, ref) === null);

// regression: rows must ALIGN across day columns (no staircase offsets)
(function () {
  const sq2 = {
    id: "qx", type: "meeting", label: "x", required: true,
    slots: ["Mon Dec 7, 10:00\u201311:30", "Tue Dec 8, 10:00\u201311:30", "Wed Dec 9, 10:00\u201311:30"],
    tz: "Australia/Perth",
    slotCells: {
      "Mon Dec 7, 10:00\u201311:30": ["2026-12-07T02:00:00.000Z","2026-12-07T02:30:00.000Z","2026-12-07T03:00:00.000Z"],
      "Tue Dec 8, 10:00\u201311:30": ["2026-12-08T02:00:00.000Z","2026-12-08T02:30:00.000Z","2026-12-08T03:00:00.000Z"],
      "Wed Dec 9, 10:00\u201311:30": ["2026-12-09T02:00:00.000Z","2026-12-09T02:30:00.000Z","2026-12-09T03:00:00.000Z"],
    },
  };
  const rg2 = createRespondentGrid(sq2, ref);
  const cells2 = rg2.element.allCells().filter((c) => c.classList.contains("allowed"));
  const rowsPerCol = {};
  for (const c of cells2) {
    const col = c.getAttribute("data-col");
    (rowsPerCol[col] = rowsPerCol[col] || []).push(c.getAttribute("data-row"));
  }
  const sigs = Object.values(rowsPerCol).map((r) => r.sort().join(","));
  assert("rows aligned across columns", new Set(sigs).size === 1, JSON.stringify(rowsPerCol));
  assert("compact grid", rg2.element.allCells().length <= 5 * 5, rg2.element.allCells().length);
})();

print("rect/cell tests OK");