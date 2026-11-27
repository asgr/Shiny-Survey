function assert(n, c, extra) { print((c?"PASS ":"FAIL ")+n+(c?"":" -- "+extra)); if(!c) throw new Error(n); }
// stub minimal pieces results.js needs at load time
document.getElementById = () => null;
document.createElementNS = (ns, t) => new Node(t);
const CFG = { owner: "asgr", publicRepo: "Shiny-Survey", privateRepo: "survey-responses" };
// prevent main() from running: define URLSearchParams stub returning null id -> showMessage needs content...
// simpler: strip the trailing main() call when loading (done in build step)

const q = { id: "qm", type: "meeting", label: "When", required: true,
  slots: ["Mon Dec 7, 10:00\u201311:30", "Wed Dec 9, 09:00\u201310:00"], tz: "Australia/Perth",
  slotCells: {
    "Mon Dec 7, 10:00\u201311:30": ["2026-12-07T02:00:00.000Z","2026-12-07T02:30:00.000Z","2026-12-07T03:00:00.000Z"],
    "Wed Dec 9, 09:00\u201310:00": ["2026-12-09T01:00:00.000Z","2026-12-09T01:30:00.000Z"] } };
const survey = { createdAt: "2026-11-25T00:00:00Z", questions: [q] };
const responses = [
  { name: "A", submittedAt: "t1", answers: { qm: {
    "Mon Dec 7, 10:00\u201311:30": "yes", "Wed Dec 9, 09:00\u201310:00": "no" } } },
  { name: "B", submittedAt: "t2", answers: { qm: {
    "Mon Dec 7, 10:00\u201311:30": "yes",
    "Mon Dec 7, 10:00\u201311:30 (parts)": ["2026-12-07T02:30:00.000Z"],
    "Wed Dec 9, 09:00\u201310:00": "yes" } } },
];
const box = meetingSummary(q, responses, survey);
// find tally table rows
function findAll(n, cls, out=[]) { if (n.classList && n.classList.contains(cls)) out.push(n); (n.children||[]).forEach(c=>findAll(c,cls,out)); return out; }
function findTag(n, tag, out=[]) { if (n.tag === tag) out.push(n); (n.children||[]).forEach(c=>findTag(c,tag,out)); return out; }
const tables = findTag(box, "table");
assert("slot table exists", tables.length >= 1);
const rows = findTag(tables[0], "tr").slice(1); // skip header
const firstRow = rows[0].children.map((td) => td.children.map((x) => x.text || "").join(""));
assert("sorted by yes", firstRow[0].includes("Mon Dec 7"), JSON.stringify(firstRow));
assert("Mon available=2 no=0", firstRow[1] === "2" && firstRow[2] === "0", JSON.stringify(firstRow));
// heatmap cells with counts
const heatCells = findAll(box, "heat-cell").filter((c) => c.children.length);
const countsByTitle = {};
for (const c of heatCells) countsByTitle[c.attrs.title.split(":")[0]] = (countsByTitle[c.attrs.title.split(":")[0]]||0)+1;
print("heat titles:", JSON.stringify(countsByTitle));
assert("5 painted cells", heatCells.length === 5, heatCells.length);
// middle Mon cell should be 2/2 with both names
const mid = heatCells.find((c) => (c.attrs.title||"").startsWith("2/2"));
assert("overlap cell 2/2", !!mid && mid.attrs.title.includes("A") && mid.attrs.title.includes("B"), mid && mid.attrs.title);
print("results tests OK");
