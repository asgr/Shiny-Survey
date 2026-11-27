function assert(n, c, extra) { print((c?"PASS ":"FAIL ")+n+(c?"":" -- "+extra)); if(!c) throw new Error(n); }
const q = { id: "qm", type: "meeting", label: "W", required: true,
  slots: ["Mon Dec 7, 10:00\u201311:30"], tz: "Australia/Perth",
  slotCells: { "Mon Dec 7, 10:00\u201311:30":
    ["2026-12-07T02:00:00.000Z","2026-12-07T02:30:00.000Z","2026-12-07T03:00:00.000Z"] } };
const box = renderQuestion(q, 0, { grid: true, refDate: new Date(2026,10,26), readOnly: true,
  viewLabel: "Green cells are the times you selected." });
const rg = box._respondGrid;
rg.setFromAnswers({ "Mon Dec 7, 10:00\u201311:30": "yes",
  "Mon Dec 7, 10:00\u201311:30 (parts)": ["2026-12-07T02:30:00.000Z"] });
const cells = rg.element.allCells();
assert("one chosen shown", cells.filter(c => c.classList.contains("chosen")).length === 1);
// painting must be inert in view mode
const allowed = cells.filter(c => c.classList.contains("allowed"));
const g = allowed[0].parent;
g.fire("pointerdown", { target: allowed[0], preventDefault() {} });
window.fire("pointerup", {});
assert("paint inert", cells.filter(c => c.classList.contains("chosen")).length === 1);
// view label present
function texts(n, out=[]) { if (n.textContent) out.push(n.textContent); if (n.text) out.push(n.text); (n.children||[]).forEach(c=>texts(c,out)); return out; }
assert("view label", texts(rg.element).some(t => t.includes("times you selected")));
// editable render still paints
const box2 = renderQuestion(q, 0, { grid: true, refDate: new Date(2026,10,26) });
const rg2 = box2._respondGrid;
rg2.setFromAnswers({ "Mon Dec 7, 10:00\u201311:30": "yes" });
const cells2 = rg2.element.allCells().filter(c => c.classList.contains("allowed"));
const g2 = cells2[0].parent;
g2.fire("pointerdown", { target: cells2[0], preventDefault() {} });
window.fire("pointerup", {});
assert("edit mode toggles", rg2.getAnswers()["Mon Dec 7, 10:00\u201311:30"] === "yes" &&
  !!rg2.getAnswers()["Mon Dec 7, 10:00\u201311:30 (parts)"]); // clicked one of 3 chosen -> now 2 = partial
print("view tests OK");
