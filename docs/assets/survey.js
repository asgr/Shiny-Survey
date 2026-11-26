// Respondent page: renders a survey definition and submits to the Worker.
"use strict";

const content = document.getElementById("content");

function showMessage(title, text) {
  content.replaceChildren(
    el("div", { class: "card thanks" }, el("h1", {}, title), el("p", { class: "subtitle" }, text))
  );
}

// Per-browser token, used for duplicate detection (never sent to GitHub files
// in raw form — the Worker hashes it).
function browserToken(surveyId) {
  const key = `survey-token-${surveyId}`;
  let t = localStorage.getItem(key);
  if (!t) {
    t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
      b.toString(16).padStart(2, "0")
    ).join("");
    try { localStorage.setItem(key, t); } catch (e) { /* private mode: token per load */ }
  }
  return t;
}

function collectAnswers(survey, form) {
  const answers = {};
  const missing = [];
  for (const q of survey.questions) {
    const name = `q_${q.id}`;
    if (q.type === "text" || q.type === "longtext") {
      const v = form.elements[name].value.trim();
      answers[q.id] = v;
      if (q.required && !v) missing.push(q.label);
    } else if (q.type === "single" || q.type === "rating") {
      const checked = form.querySelector(`input[name="${name}"]:checked`);
      answers[q.id] = checked ? checked.value : null;
      if (q.required && !checked) missing.push(q.label);
    } else if (q.type === "multi") {
      const vals = [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
      answers[q.id] = vals;
      if (q.required && vals.length === 0) missing.push(q.label);
    } else if (q.type === "meeting") {
      const box = form.querySelector(`.question[data-qid="${q.id}"]`);
      if (box && box._respondGrid) {
        // Painted grid: binary — any painted cells in a window = yes.
        const grid = box._respondGrid.getAnswers();
        answers[q.id] = grid;
        const anySelected = Object.values(grid).includes("yes");
        if (q.required && !anySelected) missing.push(q.label);
      } else {
        const grid = {};
        (q.slots || []).forEach((slot, i) => {
          const checked = form.querySelector(`input[name="${name}__${i}"]:checked`);
          grid[slot] = checked ? checked.value : null;
        });
        answers[q.id] = grid;
        if (q.required && Object.values(grid).some((v) => v === null)) missing.push(q.label);
      }
    }
  }
  return { answers, missing };
}

// Aggregate popularity per meeting question (no names/answers). Best-effort:
// if the endpoint is unavailable the grid just renders unshaded. Started in
// parallel with the definition fetch (it only needs the id); non-meeting
// surveys simply ignore the result.
function fetchPopularity(id) {
  return fetch(`${CFG.workerUrl}/popularity?surveyId=${encodeURIComponent(id)}`)
    .then((res) => (res.ok ? res.json() : {}))
    .then((data) => (data && data.counts ? data : {}))
    .catch(() => ({}));
}

// Fetch the visitor's own prior response (browser token in a header).
function fetchOwnResponse(id) {
  return fetch(`${CFG.workerUrl}/response?surveyId=${encodeURIComponent(id)}`, {
    headers: { "X-Survey-Token": browserToken(id) },
  })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
}

function renderSurvey(survey, id, popularity, existing, viewOnly) {
  document.title = survey.title || "Survey";
  const form = el("form", { novalidate: true });
  const card = el("div", { class: "card" },
    el("h1", {}, survey.title || "Survey"),
    survey.description ? el("p", { class: "subtitle" }, survey.description) : null
  );
  if (viewOnly && existing) {
    card.append(el("p", { class: "status ok show" },
      `You responded on ${new Date(existing.submittedAt).toLocaleString()}` +
      (existing.editedAt ? ` (edited ${new Date(existing.editedAt).toLocaleString()})` : "") +
      ". Your answers are shown below."));
  }

  if (survey.collectName) {
    card.append(
      el("div", { class: "question" },
        el("label", { for: "respondent-name" }, "Your name", el("span", { class: "required-mark" }, " *")),
        el("input", { type: "text", id: "respondent-name", name: "respondent_name" })
      )
    );
  }
  const refDate = survey.createdAt ? new Date(survey.createdAt) : new Date();
  survey.questions.forEach((q, i) =>
    card.append(renderQuestion(q, i, {
      grid: true, refDate, readOnly: !!viewOnly,
      viewLabel: viewOnly ? "Green cells are the times you selected." : undefined,
      popularity: popularity && popularity.counts && popularity.counts[q.id]
        ? { total: popularity.total, counts: popularity.counts[q.id] }
        : null,
    }))
  );
  form.append(card);

  // Pre-fill from the visitor's existing response when editing.
  if (existing) {
    const nameInput = form.elements["respondent_name"];
    if (nameInput && existing.name) nameInput.value = existing.name;
    for (const q of survey.questions) {
      const a = (existing.answers || {})[q.id];
      if (a === undefined || a === null) continue;
      const name = `q_${q.id}`;
      if (q.type === "text" || q.type === "longtext") {
        form.elements[name].value = a;
      } else if (q.type === "single" || q.type === "rating") {
        const inp = form.querySelector(`input[name="${name}"][value="${a}"]`);
        if (inp) inp.checked = true;
      } else if (q.type === "multi" && Array.isArray(a)) {
        for (const v of a) {
          const inp = form.querySelector(`input[name="${name}"][value="${v}"]`);
          if (inp) inp.checked = true;
        }
      } else if (q.type === "meeting") {
        const box = form.querySelector(`.question[data-qid="${q.id}"]`);
        if (box && box._respondGrid && box._respondGrid.setFromAnswers) {
          box._respondGrid.setFromAnswers(a);
        } else {
          (q.slots || []).forEach((slot, i) => {
            const v = a[slot] === "maybe" ? "yes" : a[slot];
            const inp = form.querySelector(`input[name="${name}__${i}"][value="${v}"]`);
            if (inp) inp.checked = true;
          });
        }
      }
    }
  }

  const status = el("div", { class: "status" });
  const submitBtn = el("button", { type: "submit", class: "primary" },
    existing ? "Update my response" : "Submit");

  if (viewOnly) {
    // Freeze all inputs; the grid is already readOnly (no painting).
    form.querySelectorAll("input, textarea, select").forEach((inp) => (inp.disabled = true));
    const editBtn = el("button", { type: "button", class: "primary" }, "Edit my response");
    editBtn.addEventListener("click", () => renderSurvey(survey, id, popularity, existing, false));
    form.append(editBtn);
    content.replaceChildren(form);
    return;
  }
  form.append(status, submitBtn);

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    status.className = "status";

    const nameInput = form.elements["respondent_name"];
    const respondentName = nameInput ? nameInput.value.trim() : null;
    const { answers, missing } = collectAnswers(survey, form);
    if (survey.collectName && !respondentName) missing.unshift("Your name");
    if (missing.length) {
      status.textContent = `Please answer: ${missing.join("; ")}`;
      status.className = "status error show";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting…";
    try {
      const res = await fetch(`${CFG.workerUrl}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surveyId: id, token: browserToken(id), name: respondentName, answers,
          ...(existing ? { edit: true } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showMessage(existing ? "Updated!" : "Thank you!",
          existing ? "Your response has been updated."
                   : (survey.thankYou || "Your response has been recorded."));
      } else if (res.status === 409) {
        showMessage("Already submitted", "Our records show a response from you for this survey. Each person can respond once.");
      } else if (res.status === 410) {
        showMessage("Survey closed", "This survey is no longer accepting responses.");
      } else if (res.status === 429) {
        showMessage("Survey full", "This survey has reached its response limit. Thanks for your interest!");
      } else {
        throw new Error(data.error || `Server error (${res.status})`);
      }
    } catch (err) {
      status.textContent = `Could not submit: ${err.message}. Please try again.`;
      status.className = "status error show";
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
    }
  });

  content.replaceChildren(form);
}

(async function main() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id || !/^[a-zA-Z0-9_-]{4,40}$/.test(id)) {
    showMessage("Invalid link", "This survey link is missing or malformed.");
    return;
  }
  try {
    const popPromise = fetchPopularity(id); // fire early, in parallel
    const survey = await fetchSurveyDefinition(id);
    if (!survey) {
      showMessage("Survey not found", "This survey does not exist (or was removed). Check the link with the person who shared it.");
      return;
    }
    if (survey.open === false) {
      showMessage("Survey closed", "This survey is no longer accepting responses.");
      return;
    }
    const [popularity, own] = await Promise.all([popPromise, fetchOwnResponse(id)]);
    if (own && own.answers && survey.dedup !== "off") {
      renderSurvey(survey, id, popularity, own, true); // view as entered
    } else {
      renderSurvey(survey, id, popularity);
    }
  } catch (err) {
    showMessage("Could not load survey", `Something went wrong (${err.message}). Please try again later.`);
  }
})();