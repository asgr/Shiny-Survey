const CFG = { owner: "x", privateRepo: "r", workerUrl: "https://w" };
document.getElementById = () => null;
document.createElementNS = (ns, t) => new Node(t);
function assert(n, c, extra) { print((c?"PASS ":"FAIL ")+n+(c?"":" -- "+extra)); if(!c) throw new Error(n); }
function findTag(n, tag, out=[]) { if (n.tag === tag) out.push(n); (n.children||[]).forEach(c=>findTag(c,tag,out)); return out; }
function titlesOf(svg) { return findTag(svg, "title").map(t => t.children.map(c => c.text || "").join("")); }

// render: yesno radios, dropdown select, number input, likert table
const yn = renderQuestion({ id: "a", type: "yesno", label: "YN" }, 0);
assert("yesno 2 radios", findTag(yn, "input").length === 2);
const dd = renderQuestion({ id: "b", type: "single", label: "DD", dropdown: true, options: ["x","y"] }, 0);
assert("dropdown select", findTag(dd, "select").length === 1 && findTag(dd, "input").length === 0);
const nu = renderQuestion({ id: "c", type: "number", label: "N", min: 0, max: 10 }, 0);
const ni = findTag(nu, "input")[0];
assert("number attrs", ni.attrs.type === "number" && ni.attrs.min === "0" && ni.attrs.max === "10");
const lk = renderQuestion({ id: "d", type: "likert", label: "L", rows: ["S1","S2"], scale: ["Bad","OK","Good"] }, 0);
assert("likert 6 radios", findTag(lk, "input").length === 6);

// results: numberSummary stats + histogram names
const qn = { id: "n", type: "number", label: "N" };
const rn = [
  { name: "Ann", answers: { n: 10 } },
  { name: "Ben", answers: { n: 20 } },
  { name: null, answers: { n: 30 } },
];
const nbox = numberSummary(qn, rn);
function texts(n, out=[]) { if (n.textContent) out.push(n.textContent); if (n.text) out.push(n.text); (n.children||[]).forEach(c=>texts(c,out)); return out; }
const nt = texts(nbox).join(" | ");
assert("stats", nt.includes("n = 3") && nt.includes("mean 20") && nt.includes("median 20"), nt.slice(0,150));
const nsvg = findTag(nbox, "svg")[0];
assert("histogram names", titlesOf(nsvg).some(t => t.includes("Ann") || t.includes("Ben")));

// likertSummary: stacked bars w/ names + mean
const ql = { id: "l", type: "likert", label: "L", rows: ["S1"], scale: ["Bad","OK","Good"] };
const rl = [
  { name: "Cara", answers: { l: { S1: "Good" } } },
  { name: "Dan", answers: { l: { S1: "Bad" } } },
  { name: "Eve", answers: { l: { S1: null } } },
];
const lbox = likertSummary(ql, rl);
const lsvg = findTag(lbox, "svg")[0];
const lt = titlesOf(lsvg);
assert("likert Good names", lt.some(t => t.includes("Good: 1") && t.includes("Cara")), JSON.stringify(lt));
assert("likert Bad names", lt.some(t => t.includes("Bad: 1") && t.includes("Dan")));
assert("likert no-answer names", lt.some(t => t.includes("no answer: 1") && t.includes("Eve")));
const ltable = findTag(lbox, "table")[0];
const lt2 = texts(ltable).join(" ");
assert("likert mean 2.00", lt2.includes("2.00"), lt2.slice(0,200));

// yesno through choiceSummary
const qy = { id: "y", type: "yesno", label: "YN" };
const ry = [{ name: "Fay", answers: { y: "Yes" } }, { name: "Gus", answers: { y: "No" } }];
const ybox = choiceSummary(qy, ry);
assert("yesno chart names", titlesOf(findTag(ybox, "svg")[0]).some(t => t.includes("Yes: 1") && t.includes("Fay")));
print("newtypes frontend tests OK");
