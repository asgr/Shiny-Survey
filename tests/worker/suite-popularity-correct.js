// build a survey with slotCells + slotTimes, submit mixed answers, compare
definitions["pc1x"] = { id:"pc1x", title:"P", open:true, collectName:false, dedup:"browser", maxResponses:50,
  questions:[{ id:"qm", type:"meeting", label:"W", required:false,
    slots:["A","B"],
    slotCells:{ "A":["2026-12-07T02:00:00.000Z","2026-12-07T02:30:00.000Z"] },
    slotTimes:{ "B":{start:"2026-12-08T01:00:00.000Z", end:"2026-12-08T02:00:00.000Z"} } }]};
async function run(){
  await worker.fetch(req("POST","/submit",{surveyId:"pc1x",token:"a",answers:{qm:{"A":"yes","B":"no"}}}),env);
  await worker.fetch(req("POST","/submit",{surveyId:"pc1x",token:"b",answers:{qm:{"A":"yes","A (parts)":["2026-12-07T02:00:00.000Z"],"B":"yes"}}}),env);
  const r = await worker.fetch(req("GET","/popularity?surveyId=pc1x"),env);
  const d = await r.json();
  const c = d.counts.qm;
  check("total 2", d.total===2);
  check("A 02:00 = 2 (full + part)", c["2026-12-07T02:00:00.000Z"]===2, JSON.stringify(c));
  check("A 02:30 = 1 (full only)", c["2026-12-07T02:30:00.000Z"]===1);
  check("B 01:00 = 1", c["2026-12-08T01:00:00.000Z"]===1);
  check("B 01:30 = 1", c["2026-12-08T01:30:00.000Z"]===1);
  print(`\n${passed} passed, ${failed} failed`);
}
run().catch(e=>print("ERR "+e)); drainMicrotasks();
