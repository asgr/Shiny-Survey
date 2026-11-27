// ---- tests ----
async function main() {
  // health
  let r = await worker.fetch(req("GET", "/health"), env);
  check("health 200", r.status === 200);

  // wrong origin
  r = await worker.fetch(req("POST", "/submit", {}, { origin: "https://evil.example" }), env);
  check("bad origin 403", r.status === 403);

  // unknown survey
  r = await worker.fetch(req("POST", "/submit", { surveyId: "nosuchsurvey", token: "t", answers: {} }), env);
  check("unknown survey 404", r.status === 404);

  // invalid survey id (path traversal attempt)
  r = await worker.fetch(req("POST", "/submit", { surveyId: "../evil", token: "t", answers: {} }), env);
  check("bad id 400", r.status === 400);

  // missing required single
  r = await submit({ answers: { ...goodAnswers, q1: null } });
  check("missing required 400", r.status === 400);

  // invalid choice
  r = await submit({ answers: { ...goodAnswers, q1: "z" } });
  check("invalid choice 400", r.status === 400);

  // invalid grid value
  r = await submit({ answers: { ...goodAnswers, q4: { "Mon 10am": "sure", "Tue 2pm": "no" } } });
  check("invalid grid value 400", r.status === 400);

  // missing required grid slot
  r = await submit({ answers: { ...goodAnswers, q4: { "Mon 10am": "yes" } } });
  check("missing grid slot 400", r.status === 400);

  // unknown question ids dropped
  r = await submit({ answers: { ...goodAnswers, hacker: "x" } });
  check("valid submit 200", r.status === 200, await r.text());
  let files = Object.keys(store);
  check("record + ip marker written", files.length === 2, JSON.stringify(files));
  check("ip marker prefixed", files.some((f) => f.includes("/ip-")));
  let recordFile = files.find((f) => !f.includes("/ip-"));
  let record = JSON.parse(store[recordFile]);
  check("unknown qid dropped", !("hacker" in record.answers));
  check("anonymous name null", record.name === null);
  check("no raw IP stored", !JSON.stringify(record).includes("203.0.113.7"));
  check("no raw token stored", !JSON.stringify(record).includes("tok-AAA"));
  check("grid preserved", record.answers.q4["Mon 10am"] === "yes");

  // duplicate: same token, different IP
  r = await submit({}, { "cf-connecting-ip": "198.51.100.9" });
  check("dup token 409", r.status === 409);

  // duplicate: same IP, different token
  r = await submit({ token: "tok-BBB" });
  check("dup IP 409", r.status === 409);

  // second person: new token + new IP
  r = await submit({ token: "tok-BBB" }, { "cf-connecting-ip": "198.51.100.9" });
  check("second person 200", r.status === 200);

  // third person fills the cap (maxResponses = 3)
  r = await submit({ token: "tok-CCC" }, { "cf-connecting-ip": "192.0.2.3" });
  check("third person 200", r.status === 200);
  r = await submit({ token: "tok-DDD" }, { "cf-connecting-ip": "192.0.2.4" });
  check("cap reached 429", r.status === 429);
  const canonical = Object.keys(store).filter((f) => f.startsWith("responses/testsurvey/") && !f.includes("/ip-"));
  check("no writes beyond cap", canonical.length === 3);

  // closed survey
  definitions["closedone"] = { ...baseDef, id: "closedone", open: false, questions: [] };
  r = await worker.fetch(req("POST", "/submit", { surveyId: "closedone", token: "t", answers: {} }), env);
  check("closed 410", r.status === 410);

  // named survey requires name
  definitions["namedone"] = { ...baseDef, id: "namedone", collectName: true, maxResponses: 10, questions: [] };
  r = await worker.fetch(req("POST", "/submit", { surveyId: "namedone", token: "t1", answers: {} }), env);
  check("name required 400", r.status === 400);
  r = await worker.fetch(req("POST", "/submit", { surveyId: "namedone", token: "t1", name: "  Ada  ", answers: {} }), env);
  check("named submit 200", r.status === 200);
  let namedFile = Object.keys(store).find((f) => f.startsWith("responses/namedone/"));
  check("name trimmed+stored", JSON.parse(store[namedFile]).name === "Ada");

  // dedup off allows repeats from same browser/IP
  definitions["openone"] = { ...baseDef, id: "openone", dedup: "off", maxResponses: 10, questions: [] };
  r = await worker.fetch(req("POST", "/submit", { surveyId: "openone", token: "same", answers: {} }), env);
  check("dedup off first 200", r.status === 200);
  r = await worker.fetch(req("POST", "/submit", { surveyId: "openone", token: "same", answers: {} }), env);
  check("dedup off repeat 200", r.status === 200);
  const offFiles = Object.keys(store).filter((f) => f.startsWith("responses/openone/"));
  check("dedup off distinct files", offFiles.length === 2);
  check("dedup off no dedup info", JSON.parse(store[offFiles[0]]).dedup === null);

  // browser-only mode: same token blocked, same IP w/ new token allowed
  definitions["browseronly"] = { ...baseDef, id: "browseronly", dedup: "browser", maxResponses: 10, questions: [] };
  r = await worker.fetch(req("POST", "/submit", { surveyId: "browseronly", token: "bt1", answers: {} }), env);
  check("browser mode first 200", r.status === 200);
  r = await worker.fetch(req("POST", "/submit", { surveyId: "browseronly", token: "bt1", answers: {} }), env);
  check("browser mode dup 409", r.status === 409);
  r = await worker.fetch(req("POST", "/submit", { surveyId: "browseronly", token: "bt2", answers: {} }), env);
  check("browser mode same IP new token 200", r.status === 200);

  // oversized body
  r = await worker.fetch(req("POST", "/submit", "x".repeat(40000)), env);
  check("oversized 413", r.status === 413);

  // malformed JSON
  r = await worker.fetch(req("POST", "/submit", "{not json"), env);
  check("bad json 400", r.status === 400);


  // ---- meeting parts validation ----
  definitions["partsone"] = {
    id: "partsone", title: "P", open: true, collectName: false,
    dedup: "browser", maxResponses: 50,
    questions: [{
      id: "qm", type: "meeting", label: "When", required: true,
      slots: ["Mon Dec 7, 10:00\u201311:30"], choices: ["yes","no","maybe"],
      slotCells: { "Mon Dec 7, 10:00\u201311:30": [
        "2026-12-07T02:00:00.000Z","2026-12-07T02:30:00.000Z","2026-12-07T03:00:00.000Z"] },
    }],
  };
  const slot = "Mon Dec 7, 10:00\u201311:30";
  async function psubmit(answers, token) {
    return worker.fetch(req("POST", "/submit", { surveyId: "partsone", token, answers: { qm: answers } }), env);
  }
  r = await psubmit({ [slot]: "maybe", [slot + " (parts)"]: ["2026-12-07T02:30:00.000Z"] }, "p1");
  check("valid parts 200", r.status === 200, await r.text());
  let pf = Object.keys(store).find((f) => f.startsWith("responses/partsone/") && !f.includes("/ip-"));
  let prec = JSON.parse(store[pf]);
  check("parts stored", prec.answers.qm[slot + " (parts)"][0] === "2026-12-07T02:30:00.000Z");
  r = await psubmit({ [slot]: "maybe", [slot + " (parts)"]: ["2026-12-07T02:15:00.000Z"] }, "p2");
  check("off-grid part 400", r.status === 400);
  r = await psubmit({ [slot]: "maybe", [slot + " (parts)"]: ["2026-12-08T02:00:00.000Z"] }, "p3");
  check("out-of-slot part 400", r.status === 400);
  r = await psubmit({ [slot]: "maybe", [slot + " (parts)"]: "not-an-array" }, "p4");
  check("non-array parts 400", r.status === 400);
  r = await psubmit({ [slot]: "maybe", [slot + " (parts)"]: ["garbage"] }, "p5");
  check("bad instant 400", r.status === 400);
  r = await psubmit({ [slot]: "yes" }, "p6");
  check("full yes no parts 200", r.status === 200);
  // legacy: slotTimes only -> range check accepts :15 inside range
  definitions["partslegacy"] = { ...definitions["partsone"], id: "partslegacy",
    questions: [{ ...definitions["partsone"].questions[0], slotCells: undefined,
      slotTimes: { [slot]: { start: "2026-12-07T02:00:00.000Z", end: "2026-12-07T03:30:00.000Z" } } }] };
  r = await worker.fetch(req("POST", "/submit", { surveyId: "partslegacy", token: "l1",
    answers: { qm: { [slot]: "maybe", [slot + " (parts)"]: ["2026-12-07T02:15:00.000Z"] } } }), env);
  check("legacy range part 200", r.status === 200);
  r = await worker.fetch(req("POST", "/submit", { surveyId: "partslegacy", token: "l2",
    answers: { qm: { [slot]: "maybe", [slot + " (parts)"]: ["2026-12-07T04:00:00.000Z"] } } }), env);
  check("legacy out-of-range 400", r.status === 400);


  // ---- per-question text limits ----
  definitions["textlim"] = {
    id: "textlim", title: "T", open: true, collectName: false,
    dedup: "browser", maxResponses: 50,
    questions: [
      { id: "t1", type: "text", label: "Short", required: false, maxChars: 140 },
      { id: "t2", type: "longtext", label: "Long", required: false, maxChars: 200 },
      { id: "t3", type: "text", label: "Legacy", required: false },
    ],
  };
  async function tsubmit(answers, token) {
    return worker.fetch(req("POST", "/submit", { surveyId: "textlim", token, answers }), env);
  }
  r = await tsubmit({ t1: "x".repeat(140) }, "t1");
  check("140 chars ok", r.status === 200);
  r = await tsubmit({ t1: "x".repeat(141) }, "t2");
  check("141 chars rejected", r.status === 400);
  r = await tsubmit({ t2: "x".repeat(200) }, "t3");
  check("custom long limit ok", r.status === 200);
  r = await tsubmit({ t2: "x".repeat(201) }, "t4");
  check("custom long limit enforced", r.status === 400);
  r = await tsubmit({ t3: "x".repeat(140) }, "t5");
  check("legacy short defaults 140", r.status === 200);
  r = await tsubmit({ t3: "x".repeat(141) }, "t6");
  check("legacy short default enforced", r.status === 400);
  r = await tsubmit({ t1: "x".repeat(6000) }, "t7");
  check("hard ceiling", r.status === 400);


  // ---- new question types ----
  definitions["newtypes"] = {
    id: "newtypes", title: "N", open: true, collectName: false,
    dedup: "browser", maxResponses: 50,
    questions: [
      { id: "yn", type: "yesno", label: "YN", required: true },
      { id: "yn3", type: "yesno", label: "YN3", required: false, options: ["Yes","No","N/A"] },
      { id: "num", type: "number", label: "Num", required: false, min: 0, max: 100 },
      { id: "lk", type: "likert", label: "Lk", required: true,
        rows: ["Stmt A", "Stmt B"], scale: ["Bad", "OK", "Good"] },
      { id: "dd", type: "single", label: "DD", required: false, dropdown: true, options: ["x","y","z"] },
    ],
  };
  const goodNew = { yn: "Yes", num: 42, lk: { "Stmt A": "Good", "Stmt B": "OK" }, dd: "z" };
  async function nsubmit(answers, token) {
    return worker.fetch(req("POST", "/submit", { surveyId: "newtypes", token, answers }), env);
  }
  r = await nsubmit(goodNew, "n1");
  check("new types valid 200", r.status === 200, await r.text());
  r = await nsubmit({ ...goodNew, yn: "Maybe" }, "n2");
  check("yesno invalid 400", r.status === 400);
  r = await nsubmit({ ...goodNew, yn3: "N/A" }, "n3");
  check("yesno custom option ok", r.status === 200);
  r = await nsubmit({ ...goodNew, num: 101 }, "n4");
  check("number above max 400", r.status === 400);
  r = await nsubmit({ ...goodNew, num: -1 }, "n5");
  check("number below min 400", r.status === 400);
  r = await nsubmit({ ...goodNew, num: "42" }, "n6");
  check("number as string 400", r.status === 400);
  r = await nsubmit({ ...goodNew, num: 3.14 }, "n7");
  check("decimal ok", r.status === 200);
  r = await nsubmit({ ...goodNew, lk: { "Stmt A": "Great", "Stmt B": "OK" } }, "n8");
  check("likert invalid scale 400", r.status === 400);
  r = await nsubmit({ ...goodNew, lk: { "Stmt A": "Good" } }, "n9");
  check("likert missing row 400", r.status === 400);
  r = await nsubmit({ ...goodNew, dd: "w" }, "n10");
  check("dropdown invalid 400", r.status === 400);

  print(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) throw new Error("TESTS FAILED");
}

main().catch((e) => print("ERROR: " + e + "\n" + e.stack));
drainMicrotasks();