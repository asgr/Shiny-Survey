// Private results viewer. Reads responses from the PRIVATE repo with the
// creator's token (kept in this browser only — the page itself is public
// static code and exposes nothing without a token).
"use strict";

const content = document.getElementById("content");
const TOKEN_KEY = "survey-designer-token"; // shared with the designer

// Set in config.js during setup; defaults to "<publicRepo>-responses" guess.
const PRIVATE_REPO = (CFG && CFG.privateRepo) || "survey-responses";

function getToken() { return localStorage.getItem(TOKEN_KEY) || ""; }

function showMessage(title, text) {
  content.replaceChildren(
    el("div", { class: "card thanks" }, el("h1", {}, title), el("p", { class: "subtitle" }, text))
  );
}

async function ghPrivate(path) {
  const res = await fetch(
    `https://api.github.com/repos/${CFG.owner}/${PRIVATE_REPO}/contents/${path}`,
    { headers: { Authorization: `Bearer ${getToken()}`, Accept: "application/vnd.github+json" } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  return res.json();
}

async function fetchResponses(surveyId) {
  const listing = await ghPrivate(`responses/${surveyId}`);
  if (!Array.isArray(listing)) return [];
  const files = listing.filter((f) => f.type === "file" && !f.name.startsWith("ip-"));
  const out = [];
  for (const f of files) {
    const item = await ghPrivate(f.path);
    if (item && item.content) out.push(JSON.parse(b64decode(item.content)));
  }
  out.sort((a, b) => (a.submittedAt || "").localeCompare(b.submittedAt || ""));
  return out;
}

// ---------- summaries ----------

function tallyTable(rows, headers) {
  const table = el("table", { class: "grid" });
  table.append(el("tr", {}, headers.map((h) => el("th", {}, h))));
  for (const r of rows) table.append(el("tr", {}, r.map((c) => el("td", {}, String(c)))));
  return table;
}

function choiceSummary(q, responses) {
  const counts = {};
  const opts = q.type === "rating" ? ["1", "2", "3", "4", "5"] : (q.options || []);
  for (const o of opts) counts[o] = 0;
  let unanswered = 0;
  for (const r of responses) {
    const v = (r.answers || {})[q.id];
    if (q.type === "multi") {
      if (!Array.isArray(v) || !v.length) { unanswered++; continue; }
      for (const x of v) if (x in counts) counts[x]++;
    } else {
      if (v === null || v === undefined || v === "") { unanswered++; continue; }
      if (v in counts) counts[v]++;
    }
  }
  const rows = opts.map((o) => [o, counts[o]]);
  if (unanswered) rows.push(["(no answer)", unanswered]);
  return tallyTable(rows, ["Option", "Count"]);
}

function textSummary(q, responses) {
  const items = [];
  for (const r of responses) {
    const v = (r.answers || {})[q.id];
    if (v === null || v === undefined || v === "") continue;
    items.push(el("div", { class: "survey-item" },
      el("div", { class: "hint" }, r.name || "(anonymous)"),
      el("div", {}, String(v))));
  }
  return items.length ? el("div", {}, items) : el("p", { class: "hint" }, "No answers yet.");
}

// ---------- meeting heatmap ----------

function meetingSummary(q, responses, survey) {
  const blocks = typeof resolveSlotCells === "function" ? resolveSlotCells(q, new Date(survey.createdAt)) : null;

  // Per-slot available/not counts. Legacy "maybe" answers count as
  // available (any expressed availability is a yes).
  const slotRows = (q.slots || []).map((slot) => {
    let yes = 0, no = 0, un = 0;
    for (const r of responses) {
      const a = (r.answers || {})[q.id] || {};
      const v = a[slot];
      const hasParts = Array.isArray(a[`${slot} (parts)`]) && a[`${slot} (parts)`].length;
      if (v === "yes" || v === "maybe" || hasParts) yes++;
      else if (v === "no") no++;
      else un++;
    }
    return [slot, yes, no, un];
  });
  slotRows.sort((a, b) => b[1] - a[1]);
  const box = el("div", {},
    tallyTable(slotRows, ["Time", "Available", "Not available", "No answer"]));

  if (!blocks) return box;

  // Cell-level availability: exact parts where present, full-yes expands.
  const counts = new Map(); // ts -> count
  const who = new Map();    // ts -> [names]
  for (const b of blocks) {
    for (const r of responses) {
      const a = (r.answers || {})[q.id] || {};
      const parts = a[`${b.label} (parts)`];
      let instants = null;
      if (Array.isArray(parts) && parts.length) {
        instants = parts.map((p) => Date.parse(p)).filter((ts) => b.cells.includes(ts));
      } else if (a[b.label] === "yes" || a[b.label] === "maybe") {
        instants = b.cells;
      }
      if (!instants) continue;
      for (const ts of instants) {
        counts.set(ts, (counts.get(ts) || 0) + 1);
        if (!who.has(ts)) who.set(ts, []);
        who.get(ts).push(r.name || "(anonymous)");
      }
    }
  }
  if (!counts.size) {
    box.append(el("p", { class: "hint" }, "No availability painted yet."));
    return box;
  }

  const total = responses.length;
  const stepMs = 30 * 60000;
  let viewZone = localZone();
  const heatBox = el("div", {});
  const tzSel = zoneSelect(viewZone, (z) => { viewZone = z; drawHeat(); });
  const legend = el("div", { class: "hint" },
    `Greener = more people available (out of ${total} respondent${total === 1 ? "" : "s"}). Hover a cell for names.`);

  function drawHeat() {
    const placed = [];
    for (const [ts, n] of counts) {
      const w = utcToZonedWall(ts, viewZone);
      placed.push({ ts, n, date: w.date, min: w.min });
    }
    const dates = [...new Set(placed.map((p) => p.date))].sort();
    const dateIndex = {};
    dates.forEach((d, i) => (dateIndex[d] = i));
    const cellAt = {};
    let rowMin = Infinity, rowMax = -Infinity;
    for (const p of placed) {
      const row = p.min / 30;
      cellAt[`${row}|${dateIndex[p.date]}`] = p;
      if (row < rowMin) rowMin = row;
      if (row + 1 > rowMax) rowMax = row + 1;
    }
    rowMin = Math.max(0, rowMin - 1);
    rowMax = Math.min(48, rowMax + 1);

    const g = el("div", { class: "tg-grid rg-grid" });
    g.style.gridTemplateColumns = `56px repeat(${dates.length}, 1fr)`;
    g.append(el("div", { class: "tg-corner" }));
    for (const iso of dates) {
      const d = tgParseISO(iso);
      g.append(el("div", { class: "tg-head" },
        TG_DAYS[d.getDay()], el("div", {}, `${TG_MONTHS[d.getMonth()]} ${d.getDate()}`)));
    }
    for (let r = rowMin; r < rowMax; r++) {
      const m = r * 30;
      const hour = m % 60 === 0;
      g.append(el("div", { class: "tg-time" }, hour ? tgFmtTime(m) : ""));
      for (let c = 0; c < dates.length; c++) {
        const hit = cellAt[`${r}|${c}`];
        const cell = el("div", {
          class: "tg-cell heat-cell" + (hour ? " hour" : ""),
          title: hit ? `${hit.n}/${total} available: ${who.get(hit.ts).join(", ")}` : null,
        });
        if (hit) {
          const frac = hit.n / total;
          cell.style.background = `rgba(34, 160, 107, ${0.15 + 0.85 * frac})`;
          cell.append(el("span", { class: "heat-n" }, String(hit.n)));
        }
        g.append(cell);
      }
    }
    heatBox.replaceChildren(g);
  }
  drawHeat();

  box.append(
    el("h2", { style: "margin-top:16px" }, "Availability heatmap"),
    el("div", { class: "row" }, el("label", { class: "tg-ctl" }, "Show times in", tzSel)),
    legend, heatBox
  );
  return box;
}

// ---------- page ----------

async function main() {
  const id = new URLSearchParams(location.search).get("id");
  if (!id || !/^[a-zA-Z0-9_-]{4,40}$/.test(id)) return showMessage("Invalid link", "No survey id given.");
  if (!getToken()) {
    return showMessage("Token needed",
      "Results are private. Open the designer first and save your GitHub token there, then return to this page.");
  }
  try {
    const [survey, responses] = await Promise.all([
      fetchSurveyDefinition(id, getToken()),
      fetchResponses(id),
    ]);
    if (!survey) return showMessage("Survey not found", "Check the link.");
    document.title = `Results — ${survey.title}`;

    const head = el("div", { class: "card" },
      el("div", { class: "spread" },
        el("h1", {}, `Results: ${survey.title}`),
        el("a", { href: `survey.html?id=${encodeURIComponent(id)}`, class: "hint" }, "Survey link ↗")),
      el("p", { class: "subtitle" },
        `${responses.length} response${responses.length === 1 ? "" : "s"} · ` +
        (survey.open === false ? "closed" : "open") +
        ` · cap ${survey.maxResponses || 200} · viewed privately with your token`));

    const cards = [head];
    if (!responses.length) {
      cards.push(el("div", { class: "card" }, el("p", {}, "No responses yet. Share the survey link!")));
    }
    survey.questions.forEach((q, i) => {
      const card = el("div", { class: "card" },
        el("h2", {}, `${i + 1}. ${q.label}`));
      if (q.type === "meeting") card.append(meetingSummary(q, responses, survey));
      else if (q.type === "text" || q.type === "longtext") card.append(textSummary(q, responses));
      else card.append(choiceSummary(q, responses));
      cards.push(card);
    });

    // Respondent list (names only when collected).
    if (responses.some((r) => r.name)) {
      const rows = responses.map((r) => [
        r.name || "(anonymous)",
        new Date(r.submittedAt).toLocaleString(),
      ]);
      cards.push(el("div", { class: "card" },
        el("h2", {}, "Respondents"),
        tallyTable(rows, ["Name", "Submitted (your local time)"])));
    }
    content.replaceChildren(...cards);
  } catch (err) {
    showMessage("Could not load results",
      `${err.message}. Your token needs Contents: read access on the private repo "${PRIVATE_REPO}".`);
  }
}

main();
