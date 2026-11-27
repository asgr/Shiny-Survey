function fetchCount(id) {
  // /count is one cheap listing call; /popularity reads every file.
  return fetch(`${CFG.workerUrl}/count?surveyId=${encodeURIComponent(id)}`)
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

function renderRowMeta(row) {
  const count = typeof row._count === "number"
    ? `, ${row._count} response${row._count === 1 ? "" : "s"}`
    : "";
  row._meta.textContent = `  (${row._surveyId}, ${row._state || "?"}${count})`;
  if (row._title) row._strong.textContent = row._title;
}

let countPollTimer = null;
function startCountPolling() {
  if (countPollTimer) return;
  countPollTimer = setInterval(async () => {
    if (document.visibilityState === "hidden") return;
    const rows = [...$("survey-list").children].filter((r) => r._surveyId);
    await Promise.all(rows.map(async (row) => {
      const pop = await fetchCount(row._surveyId);
      if (pop && typeof pop.total === "number" && pop.total !== row._count) {
        row._count = pop.total;
        renderRowMeta(row);
      }
    }));
  }, 60 * 1000);
}


const row = { _surveyId: "abc1", _count: 5, _state: "open", _title: "T",
  _meta: { textContent: "" }, _strong: { textContent: "T" } };
listBox.children = [row];
startCountPolling();
assert("timer registered", intervalFn !== null);
startCountPolling(); // idempotent
async function run() {
  countVal = 7;
  await intervalFn();
  assert("count updated in place", row._count === 7 && row._meta.textContent.includes("7 responses"), row._meta.textContent);
  const before = fetchCalls;
  document.visibilityState = "hidden";
  await intervalFn();
  assert("paused when hidden", fetchCalls === before);
  document.visibilityState = "visible";
  countVal = 8;
  await intervalFn();
  assert("resumes when visible", row._count === 8);
  print("poll tests OK");
}
run().catch(e => print("ERR " + e));
drainMicrotasks();
