function assert(n, c, extra) { print((c?"PASS ":"FAIL ")+n+(c?"":" -- "+extra)); if(!c) throw new Error(n); }
const q = { id: "qm", type: "meeting", label: "W", required: true,
  slots: ["Mon Dec 7, 10:00\u201311:30"], tz: "Australia/Perth",
  slotCells: { "Mon Dec 7, 10:00\u201311:30":
    ["2026-12-07T02:00:00.000Z","2026-12-07T02:30:00.000Z","2026-12-07T03:00:00.000Z"] } };
const rg = createRespondentGrid(q, new Date(2026,10,26));
// restore partial
rg.setFromAnswers({ "Mon Dec 7, 10:00\u201311:30": "yes",
  "Mon Dec 7, 10:00\u201311:30 (parts)": ["2026-12-07T02:30:00.000Z"] });
let a = rg.getAnswers();
assert("partial restored", JSON.stringify(a["Mon Dec 7, 10:00\u201311:30 (parts)"]) === JSON.stringify(["2026-12-07T02:30:00.000Z"]));
assert("one cell chosen", rg.element.allCells().filter(c => c.classList.contains("chosen")).length === 1);
// restore full
rg.setFromAnswers({ "Mon Dec 7, 10:00\u201311:30": "yes" });
a = rg.getAnswers();
assert("full restored", a["Mon Dec 7, 10:00\u201311:30"] === "yes" && !a["Mon Dec 7, 10:00\u201311:30 (parts)"]);
// restore none
rg.setFromAnswers({ "Mon Dec 7, 10:00\u201311:30": "no" });
assert("none restored", rg.getAnswers()["Mon Dec 7, 10:00\u201311:30"] === "no");
print("restore tests OK");
