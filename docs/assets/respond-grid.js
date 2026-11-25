// Respondent-side when2meet-style availability grid.
// Renders the meeting question's slots as highlighted blocks on a week grid;
// the respondent drags to paint the blocks that work for them. Answers are
// stored in the same slot -> "yes"/"no" format the Worker and R expect.
"use strict";

// Parse a generated slot label like "Mon Dec 7, 10:00–11:30" back into
// {date, startMin, endMin}. Returns null for labels we can't place on a grid
// (e.g. hand-typed slots from older surveys) — those use the table fallback.
function parseSlotLabel(label, referenceDate) {
  const m = label.match(
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{2}):(\d{2})\u2013(\d{2}):(\d{2})$/
  );
  if (!m) return null;
  const month = TG_MONTHS.indexOf(m[2]);
  const day = Number(m[3]);
  // No year in the label: pick the year (this year or next) whose date falls
  // closest to the survey's creation date, and whose weekday matches.
  const ref = referenceDate || new Date();
  const candidates = [];
  for (const y of [ref.getFullYear(), ref.getFullYear() + 1, ref.getFullYear() - 1]) {
    const d = new Date(y, month, day);
    if (d.getMonth() !== month || d.getDate() !== day) continue; // e.g. Feb 30
    candidates.push(d);
  }
  // Nearest date wins; the weekday in the label is decorative (it can be
  // wrong if someone hand-edited a slot, and must not shift the year).
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref));
  return {
    date: tgDateISO(candidates[0]),
    startMin: Number(m[4]) * 60 + Number(m[5]),
    endMin: Number(m[6]) * 60 + Number(m[7]),
  };
}

// Build a read-only-layout grid with paintable slot blocks.
// Returns {element, getAnswers()} or null if the slots can't be gridded.
function createRespondentGrid(q, referenceDate, onChange) {
  const parsed = (q.slots || []).map((s) => ({ label: s, p: parseSlotLabel(s, referenceDate) }));
  if (!parsed.length || parsed.some((x) => !x.p)) return null;

  // Geometry: dates present in slots, time span covering all slots.
  const dates = [...new Set(parsed.map((x) => x.p.date))].sort();
  const minStart = Math.min(...parsed.map((x) => x.p.startMin));
  const maxEnd = Math.max(...parsed.map((x) => x.p.endMin));
  // Step = GCD of slot boundaries relative to minStart (15/30/60 typical).
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  let step = 0;
  for (const x of parsed) {
    step = gcd(step, x.p.startMin - minStart);
    step = gcd(step, x.p.endMin - minStart);
  }
  if (step <= 0 || step > 60) step = 30;
  const startMin = Math.floor(minStart / step) * step;
  const endMin = Math.ceil(maxEnd / step) * step;

  // Which slot (if any) covers each cell.
  const slotAt = {}; // "date|min" -> slot label
  for (const { label, p } of parsed) {
    for (let m = p.startMin; m < p.endMin; m += step) slotAt[`${p.date}|${m}`] = label;
  }
  const chosen = new Set(); // slot labels the respondent painted

  const wrap = el("div", {});
  const hint = el("div", { class: "hint" },
    "Highlighted blocks are the candidate times. Drag over the blocks that work for you; drag again to unselect.");
  const summary = el("div", { class: "hint" });
  const gridEl = el("div", { class: "tg-grid rg-grid" });
  gridEl.style.gridTemplateColumns = `56px repeat(${dates.length}, 1fr)`;

  gridEl.append(el("div", { class: "tg-corner" }));
  for (const iso of dates) {
    const d = tgParseISO(iso);
    gridEl.append(el("div", { class: "tg-head" },
      TG_DAYS[d.getDay()], el("div", {}, `${TG_MONTHS[d.getMonth()]} ${d.getDate()}`)));
  }
  for (let m = startMin; m < endMin; m += step) {
    const hour = m % 60 === 0;
    gridEl.append(el("div", { class: "tg-time" }, hour || step === 60 ? tgFmtTime(m) : ""));
    for (const iso of dates) {
      const label = slotAt[`${iso}|${m}`];
      gridEl.append(el("div", {
        class: "tg-cell rg-cell" + (hour ? " hour" : "") + (label ? " allowed" : ""),
        "data-slot": label || null,
      }));
    }
  }

  function refresh() {
    for (const cell of gridEl.children) {
      if (!cell.classList || !cell.classList.contains("rg-cell")) continue;
      const label = cell.getAttribute("data-slot");
      if (label && chosen.has(label)) cell.classList.add("chosen");
      else cell.classList.remove("chosen");
    }
    summary.textContent = chosen.size
      ? `You selected: ${[...chosen].join(" \u00b7 ")}`
      : "Nothing selected yet.";
    if (onChange) onChange();
  }

  // Paint whole blocks: touching any cell of a slot toggles that slot.
  let dragging = false;
  let paintMode = true;
  const paintState = {
    finish: () => { dragging = false; refresh(); },
    abort: () => { dragging = false; },
  };

  function applyCell(cell) {
    const label = cell.getAttribute("data-slot");
    if (!label) return; // outside candidate blocks: ignore
    if (paintMode) chosen.add(label);
    else chosen.delete(label);
    // live feedback during the drag
    for (const c of gridEl.children) {
      if (c.getAttribute && c.getAttribute("data-slot") === label) {
        if (paintMode) c.classList.add("chosen");
        else c.classList.remove("chosen");
      }
    }
  }

  gridEl.addEventListener("pointerdown", (e) => {
    const cell = e.target.closest(".rg-cell");
    if (!cell || !cell.getAttribute("data-slot")) return;
    e.preventDefault();
    dragging = true;
    tgActivePaint = paintState;
    paintMode = !chosen.has(cell.getAttribute("data-slot"));
    applyCell(cell);
  });
  gridEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const t = document.elementFromPoint(e.clientX, e.clientY);
    const cell = t && t.closest ? t.closest(".rg-cell") : null;
    if (cell && gridEl.contains(cell)) applyCell(cell);
  });

  wrap.append(hint, gridEl, summary);
  return {
    element: wrap,
    // Same shape the table produced: slot -> "yes"/"no" (unpainted = "no").
    getAnswers: () => {
      const out = {};
      for (const { label } of parsed) out[label] = chosen.has(label) ? "yes" : "no";
      return out;
    },
  };
}