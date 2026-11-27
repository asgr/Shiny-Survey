let resultsPollTimer = null;
let lastSignature = null;
let latestResponses = null;

function responsesSignature(responses) {
  return responses.length + ":" +
    (responses.length ? responses[responses.length - 1].submittedAt || "" : "");
}

function startResultsPolling(id) {
  if (resultsPollTimer) return;
  resultsPollTimer = setInterval(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const res = await fetch(`${CFG.workerUrl}/count?surveyId=${encodeURIComponent(id)}`);
      if (!res.ok) return;
      const { total } = await res.json();
      if (typeof total !== "number" || total === (latestResponses || []).length) return;
      const responses = await fetchResponses(id);
      const sig = responsesSignature(responses);
      if (sig === lastSignature) { latestResponses = responses; return; }
      // Re-render with fresh data (definition re-read too: open/closed may change).
      const survey = await fetchSurveyDefinition(id, getToken());
      if (survey) {
        lastSignature = sig;
        latestResponses = responses;
        renderResults(survey, responses, id);
      }
    } catch (e) { /* transient errors: try again next tick */ }
  }, 60 * 1000);
}


function renderResults(survey, responses, id) { renders++; }
lastSignature = responsesSignature(liveResponses);
latestResponses = liveResponses.slice();
startResultsPolling("abcd1234");
async function run() {
  // no change: count matches -> no file fetch, no render
  await intervalFn();
  assert("no-change: no file reads", fileFetches === 0 && renders === 0);
  // new response arrives
  countVal = 3;
  liveResponses.push({ submittedAt: "2026-11-26T11:00:00Z", name: "C" });
  await intervalFn();
  assert("change: fetched + rendered", fileFetches === 1 && renders === 1);
  assert("signature updated", lastSignature === responsesSignature(liveResponses));
  // same data next tick -> no re-render
  await intervalFn();
  assert("stable: no extra render", renders === 1);
  // hidden tab: no calls
  const before = fetchCountCalls;
  document.visibilityState = "hidden";
  await intervalFn();
  assert("hidden pause", fetchCountCalls === before);
  print("results poll tests OK");
}
run().catch(e => print("ERR " + e + "\n" + e.stack));
drainMicrotasks();
