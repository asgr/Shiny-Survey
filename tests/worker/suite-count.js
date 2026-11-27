async function main() {
  definitions["cnt1"] = { id: "cnt1", title: "C", open: true, collectName: false,
    dedup: "browser", maxResponses: 50, questions: [] };
  // no responses yet
  let r = await worker.fetch(req("GET", "/count?surveyId=cnt1"), env);
  let d = await r.json();
  check("empty count 0", r.status === 200 && d.total === 0, JSON.stringify(d));
  // submit two
  await worker.fetch(req("POST", "/submit", { surveyId: "cnt1", token: "c1", answers: {} }), env);
  await worker.fetch(req("POST", "/submit", { surveyId: "cnt1", token: "c2", answers: {} }), env);
  r = await worker.fetch(req("GET", "/count?surveyId=cnt1"), env);
  d = await r.json();
  check("count 2 after submits (cache invalidated)", d.total === 2, JSON.stringify(d));
  check("count only total", Object.keys(d).join() === "total");
  // bad origin
  r = await worker.fetch(req("GET", "/count?surveyId=cnt1", null, { origin: "https://evil.example" }), env);
  check("count bad origin 403", r.status === 403);
  // invalid id
  r = await worker.fetch(req("GET", "/count?surveyId=../x"), env);
  check("count bad id 400", r.status === 400);
  print(`\n${passed} passed, ${failed} failed`);
  if (failed) throw new Error("FAILED");
}
main().catch((e) => print("ERROR: " + e + "\n" + e.stack));
drainMicrotasks();
