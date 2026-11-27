function assert(n, c, extra) { print((c?"PASS ":"FAIL ")+n+(c?"":" -- "+extra)); if(!c) throw new Error(n); }
const q = { id: "qm", type: "meeting", label: "When", required: true,
  slots: ["Mon Dec 7, 10:00\u201311:30"], tz: "Australia/Perth",
  slotCells: { "Mon Dec 7, 10:00\u201311:30":
    ["2026-12-07T02:00:00.000Z","2026-12-07T02:30:00.000Z","2026-12-07T03:00:00.000Z"] } };
const pop = { total: 10, counts: {
  "2026-12-07T02:00:00.000Z": 2,
  "2026-12-07T02:30:00.000Z": 10,
  "2026-12-07T03:00:00.000Z": 1 } };
const rg = createRespondentGrid(q, new Date(2026,10,25), null, { popularity: pop });
const cells = rg.element.allCells().filter((c) => c.classList.contains("allowed"));
assert("3 allowed", cells.length === 3);
const alphaOf = (c) => Number((c.style.background.match(/rgba\([^)]*, ([0-9.]+)\)/) || [])[1]);
const a0 = alphaOf(cells.find(c => c.getAttribute("data-ts") === String(Date.parse("2026-12-07T02:00:00.000Z"))));
const a1 = alphaOf(cells.find(c => c.getAttribute("data-ts") === String(Date.parse("2026-12-07T02:30:00.000Z"))));
const a2 = alphaOf(cells.find(c => c.getAttribute("data-ts") === String(Date.parse("2026-12-07T03:00:00.000Z"))));
assert("max cell opaque", a1 === 1, a1);
assert("popular > unpopular", a0 > a2 && a0 < a1, `${a0} ${a2}`);
assert("floor visible", a2 >= 0.15, a2);
assert("blue rgb", cells[0].style.background.includes("76, 141, 255"));
// drag across all cells -> all green with SAME alphas
const g = cells[0].parent;
const mid = cells.find(c => c.getAttribute("data-ts") === String(Date.parse("2026-12-07T02:30:00.000Z")));
g.fire("pointerdown", { target: cells[0], preventDefault() {} });
document._hover = cells[cells.length - 1];
g.fire("pointermove", { clientX: 0, clientY: 0 });
window.fire("pointerup", {});
assert("all chosen", cells.every((c) => c.classList.contains("chosen")));
assert("green rgb", cells[0].style.background.includes("34, 160, 107"));
assert("alpha preserved after choose", alphaOf(mid) === 1 && alphaOf(cells[0]) === a0);
// single click on chosen mid cell -> only that cell back to blue
g.fire("pointerdown", { target: mid, preventDefault() {} });
window.fire("pointerup", {});
assert("click deselects one", !mid.classList.contains("chosen") && cells[0].classList.contains("chosen"));
assert("deselected back to blue", mid.style.background.includes("76, 141, 255"));
// count note present
function findTexts(n, out=[]) { if (n.textContent) out.push(n.textContent); (n.children||[]).forEach(c=>findTexts(c,out)); return out; }
const texts = findTexts(rg.element).join(" | ");
assert("respondent count shown", texts.includes("10 people have responded"), texts.slice(0,200));
// no popularity -> plain classes, no inline bg
const rg2 = createRespondentGrid(q, new Date(2026,10,25));
const c2 = rg2.element.allCells().filter((c) => c.classList.contains("allowed"));
assert("no inline bg without pop", !c2[0].style.background);

// tooltip + range note
const titles = cells.map((c) => c.attrs.title);
assert("tooltips present", titles.every((t) => t && t.includes("of 10 available")), JSON.stringify(titles));
assert("tooltip counts", titles.some((t) => t.startsWith("10 of 10")) && titles.some((t) => t.startsWith("1 of 10")), JSON.stringify(titles));
const noteTexts = findTexts(rg.element).join(" | ");
assert("range note", noteTexts.includes("ranges from 1 to 10"), noteTexts.slice(0, 300));
// zero-popularity cell in range: add a 4th slot cell with no counts
const q2 = JSON.parse(JSON.stringify(q));
q2.slotCells[q2.slots[0]].push("2026-12-07T03:30:00.000Z");
const rg3 = createRespondentGrid(q2, new Date(2026,10,25), null, { popularity: pop });
const note3 = findTexts(rg3.element).join(" | ");
assert("min includes uncounted cells", note3.includes("ranges from 0 to 10"), note3.slice(0,300));

print("popularity shading tests OK");
