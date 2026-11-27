async function main() {
  // seed a survey with slotCells and two responses via the normal submit path
  definitions["popone"] = {
    id: "popone", title: "P", open: true, collectName: true,
    dedup: "browser", maxResponses: 50,
    questions: [{
      id: "qm", type: "meeting", label: "When", required: true,
      slots: ["Mon Dec 7, 10:00\u201311:30"], choices: ["yes","no"],
      slotCells: { "Mon Dec 7, 10:00\u201311:30": [
        "2026-12-07T02:00:00.000Z","2026-12-07T02:30:00.000Z","2026-12-07T03:00:00.000Z"] },
    }],
  };
  const slot = "Mon Dec 7, 10:00\u201311:30";
  let r = await worker.fetch(req("POST", "/submit", { surveyId: "popone", token: "pp1", name: "Secret Alice",
    answers: { qm: { [slot]: "yes" } } }), env);
  check("submit full 200", r.status === 200);
  r = await worker.fetch(req("POST", "/submit", { surveyId: "popone", token: "pp2", name: "Secret Bob",
    answers: { qm: { [slot]: "yes", [slot + " (parts)"]: ["2026-12-07T02:30:00.000Z"] } } }), env);
  check("submit partial 200", r.status === 200);

  r = await worker.fetch(req("GET", "/popularity?surveyId=popone"), env);
  check("popularity 200", r.status === 200);
  const data = await r.json();
  check("total=2", data.total === 2, JSON.stringify(data));
  check("first cell 1", data.counts.qm["2026-12-07T02:00:00.000Z"] === 1);
  check("mid cell 2", data.counts.qm["2026-12-07T02:30:00.000Z"] === 2);
  check("last cell 1", data.counts.qm["2026-12-07T03:00:00.000Z"] === 1);
  const body = JSON.stringify(data);
  check("no names leaked", !body.includes("Alice") && !body.includes("Bob"));
  check("no answers leaked", !body.includes("answers") && !body.includes("parts"));
  check("no dedup keys", !body.includes("dedup") && !body.includes(env.IP_SALT));
  // bad origin
  r = await worker.fetch(req("GET", "/popularity?surveyId=popone", null, { origin: "https://evil.example" }), env);
  check("bad origin 403", r.status === 403);
  // unknown survey
  r = await worker.fetch(req("GET", "/popularity?surveyId=nosuchpop"), env);
  check("unknown 404", r.status === 404);
  // empty survey -> total 0
  definitions["popempty"] = { ...definitions["popone"], id: "popempty" };
  r = await worker.fetch(req("GET", "/popularity?surveyId=popempty"), env);
  const empty = await r.json();
  check("empty total 0", empty.total === 0);
  print(`\n${passed} passed, ${failed} failed`);
  if (failed) throw new Error("FAILED");
}
main().catch((e) => print("ERROR: " + e + "\n" + e.stack));
drainMicrotasks();
