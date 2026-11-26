// Designer page: build a survey definition and publish it to the public repo.
"use strict";

const TOKEN_KEY = "survey-designer-token";
const TYPE_LABELS = {
  text: "Short text", longtext: "Long text", single: "Single choice",
  multi: "Multiple choice", rating: "Rating 1–5", meeting: "Meeting grid",
};

let survey = blankSurvey();
let editingSha = null; // set when editing an existing survey file

function blankSurvey() {
  return {
    id: newSurveyId(),
    title: "",
    description: "",
    collectName: false,
    dedup: "browser+ip",
    maxResponses: 200,
    open: true,
    createdAt: new Date().toISOString(),
    questions: [],
  };
}

function $(id) { return document.getElementById(id); }

function setStatus(id, msg, kind) {
  const node = $(id);
  node.textContent = msg;
  node.className = `status show ${kind}`;
}

function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }

// ---------- settings <-> state ----------
function settingsToState() {
  survey.title = $("s-title").value.trim();
  survey.description = $("s-desc").value.trim();
  survey.collectName = $("s-name").value === "yes";
  survey.dedup = $("s-dedup").value;
  survey.maxResponses = Math.max(1, Math.min(1000, Number($("s-cap").value) || 200));
  survey.open = $("s-open").value === "yes";
}

function stateToSettings() {
  $("s-title").value = survey.title || "";
  $("s-desc").value = survey.description || "";
  $("s-name").value = survey.collectName ? "yes" : "no";
  $("s-dedup").value = survey.dedup || "browser+ip";
  $("s-cap").value = survey.maxResponses || 200;
  $("s-open").value = survey.open === false ? "no" : "yes";
}

// ---------- question editor ----------
function questionEditor(q, i) {
  const card = el("div", { class: "question" });
  card.append(
    el("div", { class: "spread" },
      el("strong", {}, `${i + 1}. ${TYPE_LABELS[q.type] || q.type}`),
      el("div", { class: "row" },
        el("button", { class: "small", onclick: () => moveQuestion(i, -1), disabled: i === 0 ? "" : null }, "↑"),
        el("button", { class: "small", onclick: () => moveQuestion(i, 1), disabled: i === survey.questions.length - 1 ? "" : null }, "↓"),
        el("button", { class: "small danger", onclick: () => { survey.questions.splice(i, 1); redraw(); } }, "Remove")
      )
    )
  );

  const labelInput = el("input", {
    type: "text", value: q.label, placeholder: "Question text",
    oninput: (e) => { q.label = e.target.value; drawPreview(); },
  });
  card.append(el("div", { style: "margin-top:8px" }, labelInput));

  if (q.type === "text" || q.type === "longtext") {
    if (!q.maxChars) q.maxChars = q.type === "text" ? 140 : 5000;
    const lim = el("input", {
      type: "number", min: 1, max: 5000, value: q.maxChars, style: "width:100px",
      oninput: (e) => {
        q.maxChars = Math.max(1, Math.min(5000, Number(e.target.value) || (q.type === "text" ? 140 : 5000)));
        drawPreview();
      },
    });
    card.append(el("label", { class: "tg-ctl", style: "margin-top:8px" }, "Character limit (max 5000)", lim));
  }

  if (q.type === "single" || q.type === "multi") {
    const opts = el("textarea", {
      rows: 4, placeholder: "One option per line",
      oninput: (e) => {
        q.options = e.target.value.split("\n").map((s) => s.trim()).filter(Boolean);
        drawPreview();
      },
    });
    opts.value = (q.options || []).join("\n");
    card.append(el("div", { class: "hint", style: "margin-top:8px" }, "Options, one per line:"), opts);
  }

  if (q.type === "meeting") {
    const dispSel = el("select", { style: "width:auto",
      onchange: (e) => { q.display = e.target.value; drawPreview(); } },
      el("option", { value: "grid" }, "Heatmap grid (when2meet style)"),
      el("option", { value: "list" }, "Simple list (available / not per window)")
    );
    dispSel.value = q.display || "grid";
    card.append(
      el("label", { class: "tg-ctl", style: "margin-top:8px" }, "Respondents see", dispSel),
      el("div", { class: "hint", style: "margin-top:8px" },
        "Drag across the grid to pick candidate times (respondents mark which times they're available). " +
        "Adjacent cells merge into one time range. The list view suits few windows spread over many days."),
      createTimeGridEditor(q, drawPreview)
    );
  }

  const req = el("input", {
    type: "checkbox", onchange: (e) => { q.required = e.target.checked; drawPreview(); },
  });
  req.checked = !!q.required;
  card.append(el("label", { class: "option", style: "margin-top:8px" }, req, "Required"));
  return card;
}

function moveQuestion(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= survey.questions.length) return;
  const [q] = survey.questions.splice(i, 1);
  survey.questions.splice(j, 0, q);
  redraw();
}

function addQuestion(type) {
  // Random id (not positional) so reordering never collides with stored answers.
  const q = { id: `q_${newSurveyId()}`, type, label: "", required: false };
  if (type === "text") q.maxChars = 140;
  if (type === "longtext") q.maxChars = 5000;
  if (type === "single" || type === "multi") q.options = [];
  if (type === "meeting") { q.slots = []; q.choices = ["yes", "no"]; q.display = "grid"; }
  survey.questions.push(q);
  redraw();
}

// ---------- preview ----------
function drawPreview() {
  const box = $("preview");
  const nodes = [];
  nodes.push(el("h2", {}, survey.title || "Untitled survey"));
  if (survey.description) nodes.push(el("p", { class: "hint" }, survey.description));
  let idx = 0;
  if (survey.collectName) {
    nodes.push(el("div", { class: "question" },
      el("div", { class: "q-label" }, "Your name", el("span", { class: "required-mark" }, " *")),
      el("input", { type: "text", disabled: "" })));
  }
  // Show meeting questions exactly as respondents will see them.
  for (const q of survey.questions) {
    nodes.push(renderQuestion(q, idx++, { grid: true, readOnly: true, refDate: new Date() }));
  }
  if (!survey.questions.length) nodes.push(el("p", { class: "hint" }, "Add questions to see a preview."));
  const btn = el("button", { class: "primary", disabled: "", style: "margin-top:12px" }, "Submit");
  nodes.push(btn);
  box.replaceChildren(...nodes);
}

function redraw() {
  if (typeof tgActivePaint !== "undefined" && tgActivePaint) {
    tgActivePaint.abort();
    tgActivePaint = null;
  }
  $("questions").replaceChildren(...survey.questions.map(questionEditor));
  drawPreview();
}

// ---------- publish ----------
async function publish() {
  const token = getToken();
  if (!token) return setStatus("publish-status", "Save a GitHub token first.", "error");
  settingsToState();

  if (!survey.title) return setStatus("publish-status", "Give the survey a title.", "error");
  if (!survey.questions.length) return setStatus("publish-status", "Add at least one question.", "error");
  for (const q of survey.questions) {
    if (!q.label.trim()) return setStatus("publish-status", "Every question needs text.", "error");
    if ((q.type === "single" || q.type === "multi") && !(q.options || []).length) {
      return setStatus("publish-status", `Add options for: ${q.label}`, "error");
    }
    if (q.type === "meeting" && !(q.slots || []).length) {
      return setStatus("publish-status", `Add date/times for: ${q.label}`, "error");
    }
  }

  const btn = $("publish");
  btn.disabled = true;
  $("publish-info").textContent = "Publishing…";
  try {
    if (!editingSha) {
      const existing = await getSurveyFile(survey.id, token);
      if (existing) editingSha = existing.sha;
    }
    const result = await putSurveyFile(survey.id, survey, token, editingSha,
      editingSha ? `Update survey ${survey.id}` : `New survey ${survey.id}: ${survey.title}`);
    editingSha = result.content.sha;
    const link = surveyLink(survey.id);
    $("share-link").textContent = link;
    $("share").style.display = "block";
    $("publish-info").textContent = "";
    setStatus("publish-status",
      "Published. Respondents may see the previous version for up to 5 minutes (GitHub caching).", "ok");
    refreshList();
  } catch (err) {
    $("publish-info").textContent = "";
    setStatus("publish-status", `Publish failed: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

// ---------- existing surveys ----------
async function refreshList() {
  const token = getToken();
  const box = $("survey-list");
  if (!token) { box.replaceChildren(el("p", { class: "hint" }, "Save a token to list surveys.")); return; }
  box.replaceChildren(el("p", { class: "hint" }, "Loading…"));
  try {
    const ids = await listSurveys(token);
    if (!ids.length) { box.replaceChildren(el("p", { class: "hint" }, "No surveys yet.")); return; }
    const items = [];
    for (const id of ids) {
      const row = el("div", { class: "survey-item" });
      const title = el("div", {}, el("strong", {}, id));
      const actions = el("div", { class: "row", style: "margin-top:4px" },
        el("button", { class: "small", onclick: () => loadSurvey(id) }, "Edit"),
        el("button", { class: "small primary", onclick: () => window.open(`results.html?id=${encodeURIComponent(id)}`, "_blank") }, "Results"),
        el("button", { class: "small", onclick: (e) => copyLink(id, e.target) }, "Copy link"),
        el("button", { class: "small", onclick: (e) => toggleOpen(id, e.target) }, "Open / close"),
        el("button", { class: "small danger", onclick: (e) => deleteSurvey(id, e.target) }, "Delete")
      );
      row.append(title, actions);
      items.push(row);
      // Fill in title/state and response count asynchronously (in parallel).
      Promise.all([
        getSurveyFile(id, token).catch(() => null),
        fetch(`${CFG.workerUrl}/popularity?surveyId=${encodeURIComponent(id)}`)
          .then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]).then(([f, pop]) => {
        const s = f && f.survey;
        const state = s ? (s.open === false ? "closed" : "open") : "?";
        const count = pop && typeof pop.total === "number"
          ? `, ${pop.total} response${pop.total === 1 ? "" : "s"}`
          : "";
        title.replaceChildren(el("strong", {}, (s && s.title) || id),
          el("span", { class: "hint" }, `  (${id}, ${state}${count})`));
      });
    }
    box.replaceChildren(...items);
  } catch (err) {
    box.replaceChildren(el("p", { class: "hint" }, `Could not list surveys: ${err.message}`));
  }
}

async function loadSurvey(id) {
  try {
    const f = await getSurveyFile(id, getToken());
    if (!f) return setStatus("publish-status", "Survey file not found.", "error");
    survey = f.survey;
    editingSha = f.sha;
    stateToSettings();
    redraw();
    $("share-link").textContent = surveyLink(id);
    $("share").style.display = "block";
    setStatus("publish-status",
      `Editing "${survey.title}". Change settings/questions, then click "Publish survey" to save — edits are not live until you publish.`, "ok");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    setStatus("publish-status", `Could not load: ${err.message}`, "error");
  }
}

async function toggleOpen(id, btn) {
  btn.disabled = true;
  try {
    const f = await getSurveyFile(id, getToken());
    if (!f) throw new Error("not found");
    f.survey.open = f.survey.open === false;
    await putSurveyFile(id, f.survey, getToken(), f.sha,
      `${f.survey.open ? "Open" : "Close"} survey ${id}`);
    if (survey.id === id) { survey = f.survey; editingSha = f.sha; stateToSettings(); }
    refreshList();
  } catch (err) {
    setStatus("publish-status", `Toggle failed: ${err.message}`, "error");
    btn.disabled = false;
  }
}

async function deleteSurvey(id, btn) {
  const ok = confirm(
    `Delete survey "${id}"?\n\n` +
    "This removes the survey definition and its share link stops working " +
    "(within a few minutes of GitHub cache expiry).\n\n" +
    "Responses already collected are NOT deleted — they stay in your " +
    "private repo and remain readable in R. Remove them there separately " +
    "if you want them gone.\n\n" +
    "This cannot be undone from this page."
  );
  if (!ok) return;
  btn.disabled = true;
  try {
    const f = await getSurveyFile(id, getToken());
    if (!f) throw new Error("survey file not found (already deleted?)");
    await deleteSurveyFile(id, getToken(), f.sha);
    if (survey.id === id) {
      survey = blankSurvey();
      editingSha = null;
      stateToSettings();
      redraw();
      $("share").style.display = "none";
    }
    setStatus("publish-status", `Deleted "${id}". Collected responses remain in the private repo.`, "ok");
    refreshList();
  } catch (err) {
    setStatus("publish-status", `Delete failed: ${err.message}`, "error");
    btn.disabled = false;
  }
}

function copyLink(id, btn) {
  navigator.clipboard.writeText(surveyLink(id)).then(() => {
    const old = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => (btn.textContent = old), 1500);
  });
}

// ---------- wiring ----------
$("save-token").addEventListener("click", async () => {
  const t = $("gh-token").value.trim();
  if (!t) return setStatus("token-status", "Paste a token first.", "error");
  try {
    // Verify the token can see the repo before saving it.
    await ghRequest("surveys", { token: t });
    localStorage.setItem(TOKEN_KEY, t);
    $("gh-token").value = "";
    setStatus("token-status", "Token verified and saved in this browser.", "ok");
    refreshList();
  } catch (err) {
    setStatus("token-status", `Token check failed: ${err.message}`, "error");
  }
});

$("clear-token").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  setStatus("token-status", "Token cleared from this browser.", "ok");
  refreshList();
});

$("new-survey").addEventListener("click", () => {
  survey = blankSurvey();
  editingSha = null;
  stateToSettings();
  redraw();
  $("share").style.display = "none";
  $("publish-status").className = "status";
});

$("add-type").addEventListener("change", (e) => {
  if (e.target.value) addQuestion(e.target.value);
  e.target.value = "";
});

["s-title", "s-desc", "s-name", "s-dedup", "s-cap", "s-open"].forEach((id) =>
  $(id).addEventListener("input", () => { settingsToState(); drawPreview(); })
);

$("publish").addEventListener("click", publish);
$("refresh-list").addEventListener("click", refreshList);
$("copy-link").addEventListener("click", (e) =>
  navigator.clipboard.writeText($("share-link").textContent).then(() => {
    e.target.textContent = "Copied!";
    setTimeout(() => (e.target.textContent = "Copy"), 1500);
  })
);

stateToSettings();
redraw();
if (getToken()) {
  setStatus("token-status", "Token loaded from this browser.", "ok");
  refreshList();
}