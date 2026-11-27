async function main() {
  definitions["edit1"] = { id: "edit1", title: "E", open: true, collectName: true,
    dedup: "browser+ip", maxResponses: 50,
    questions: [{ id: "qs", type: "single", label: "Pick", required: true, options: ["a","b"] }] };
  // initial submit
  let r = await worker.fetch(req("POST", "/submit", { surveyId: "edit1", token: "et1", name: "Ed", answers: { qs: "a" } }), env);
  check("initial 200", r.status === 200);
  // lookup own response
  r = await worker.fetch(req("GET", "/response?surveyId=edit1", null, { "x-survey-token": "et1" }), env);
  check("lookup 200", r.status === 200);
  let d = await r.json();
  check("lookup answers", d.answers.qs === "a" && d.name === "Ed");
  check("no dedup leak", !JSON.stringify(d).includes("dedup") && !JSON.stringify(d).includes("et1"));
  // other token: 404
  r = await worker.fetch(req("GET", "/response?surveyId=edit1", null, { "x-survey-token": "other" }), env);
  check("other token 404", r.status === 404);
  // no token: 400
  r = await worker.fetch(req("GET", "/response?surveyId=edit1"), env);
  check("no token 400", r.status === 400);
  // bad origin
  r = await worker.fetch(req("GET", "/response?surveyId=edit1", null, { "x-survey-token": "et1", origin: "https://evil.example" }), env);
  check("bad origin 403", r.status === 403);
  // edit from a DIFFERENT IP (should succeed, not 409)
  r = await worker.fetch(req("POST", "/submit",
    { surveyId: "edit1", token: "et1", name: "Ed", answers: { qs: "b" }, edit: true },
    { "cf-connecting-ip": "198.51.100.77" }), env);
  check("edit 200 across IP", r.status === 200, await r.text());
  // verify updated
  r = await worker.fetch(req("GET", "/response?surveyId=edit1", null, { "x-survey-token": "et1" }), env);
  d = await r.json();
  check("edit persisted", d.answers.qs === "b");
  check("editedAt set", !!d.editedAt);
  check("submittedAt preserved", d.submittedAt < d.editedAt);
  // count unchanged (still 1 canonical)
  r = await worker.fetch(req("GET", "/count?surveyId=edit1"), env);
  check("count still 1", (await r.json()).total === 1);
  // edit with unknown token: 404
  r = await worker.fetch(req("POST", "/submit", { surveyId: "edit1", token: "ghost", name: "X", answers: { qs: "a" }, edit: true }), env);
  check("edit unknown 404", r.status === 404);
  // edit invalid answer rejected
  r = await worker.fetch(req("POST", "/submit", { surveyId: "edit1", token: "et1", name: "Ed", answers: { qs: "z" }, edit: true }), env);
  check("edit invalid 400", r.status === 400);
  // normal resubmit still 409
  r = await worker.fetch(req("POST", "/submit", { surveyId: "edit1", token: "et1", name: "Ed", answers: { qs: "a" } }), env);
  check("resubmit still 409", r.status === 409);
  // dedup off: edit refused
  definitions["editoff"] = { ...definitions["edit1"], id: "editoff", dedup: "off", questions: [] };
  await worker.fetch(req("POST", "/submit", { surveyId: "editoff", token: "o1", name: "O", answers: {} }), env);
  r = await worker.fetch(req("POST", "/submit", { surveyId: "editoff", token: "o1", name: "O", answers: {}, edit: true }), env);
  check("off-mode edit 400", r.status === 400);
  print(`\n${passed} passed, ${failed} failed`);
  if (failed) throw new Error("FAILED");
}
main().catch((e) => print("ERROR: " + e + "\n" + e.stack));
drainMicrotasks();
