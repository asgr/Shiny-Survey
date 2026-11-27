function assert(n, c, extra) { print((c?"PASS ":"FAIL ")+n+(c?"":" -- "+extra)); if(!c) throw new Error(n); }
const CFG = { workerUrl: "https://w.example" };
const document = { visibilityState: "visible" };
function getToken() { return "tok"; }
let countVal = 2, fetchCountCalls = 0, fileFetches = 0, renders = 0;
let liveResponses = [
  { submittedAt: "2026-11-26T10:00:00Z", name: "A" },
  { submittedAt: "2026-11-26T10:05:00Z", name: "B" },
];
globalThis.fetch = async (url) => {
  if (url.includes("/count")) { fetchCountCalls++; return { ok: true, json: async () => ({ total: countVal }) }; }
  throw new Error("unexpected fetch " + url);
};
async function fetchResponses(id) { fileFetches++; return liveResponses.slice(); }
async function fetchSurveyDefinition(id) { return { title: "T", questions: [], open: true }; }
let intervalFn = null;
function setInterval(fn, ms) { assert("60s", ms === 60000); intervalFn = fn; return 1; }
