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
// if the endpoint is unavailable the grid just renders unshaded.
async function fetchPopularity(id, survey) {
  if (!survey.questions.some((q) => q.type === "meeting")) return {};
  try {
    const res = await fetch(`${CFG.workerUrl}/popularity?surveyId=${encodeURIComponent(id)}`);
    if (!res.ok) return {};
    const data = await res.json();
    return data && data.counts ? data : {};
  } catch (e) {
    return {};
  }
}

function renderSurvey(survey, id, popularity) {
  document.title = survey.title || "Survey";
  const form = el("form", { novalidate: true });
  const card = el("div", { class: "card" },
    el("h1", {}, survey.title || "Survey"),
    survey.description ? el("p", { class: "subtitle" }, survey.description) : null
  );

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
      grid: true, refDate,
      popularity: popularity && popularity.counts && popularity.counts[q.id]
        ? { total: popularity.total, counts: popularity.counts[q.id] }
        : null,
    }))
  );
  form.append(card);

  const status = el("div", { class: "status" });
  const submitBtn = el("button", { type: "submit", class: "primary" }, "Submit");
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
        body: JSON.stringify({ surveyId: id, token: browserToken(id), name: respondentName, answers }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        showMessage("Thank you!", survey.thankYou || "Your response has been recorded.");
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
    const survey = await fetchSurveyDefinition(id);
    if (!survey) {
      showMessage("Survey not found", "This survey does not exist (or was removed). Check the link with the person who shared it.");
      return;
    }
    if (survey.open === false) {
      showMessage("Survey closed", "This survey is no longer accepting responses.");
      return;
    }
    const popularity = await fetchPopularity(id, survey);
    renderSurvey(survey, id, popularity);
  } catch (err) {
    showMessage("Could not load survey", `Something went wrong (${err.message}). Please try again later.`);
  }
})();