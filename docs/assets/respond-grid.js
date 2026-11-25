// Respondent-side when2meet-style availability grid.
// Candidate times render as highlighted 30-minute cells; the respondent
// drags a rectangle over the cells that work for them (click toggles one).
// Answers are per candidate block: full coverage = "yes", partial = "maybe",
// none = "no", plus the exact chosen 30-min instants in "<slot> (parts)".
// Block keys stay the organizer's ORIGINAL labels, so answers from any
// viewer timezone aggregate into the same columns.
"use strict";

const RG_STEP = 30; // minutes — harmonized with the organizer grid

// Parse a generated slot label like "Mon Dec 7, 10:00–11:30" back into
// {date, startMin, endMin} (fallback for surveys without slotCells/slotTimes).
function parseSlotLabel(label, referenceDate) {
  const m = label.match(
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{2}):(\d{2})\u2013(\d{2}):(\d{2})$/
  );
  if (!m) return null;
  const month = TG_MONTHS.indexOf(m[2]);
  const day = Number(m[3]);
  const ref = referenceDate || new Date();
  const candidates = [];
  for (const y of [ref.getFullYear(), ref.getFullYear() + 1, ref.getFullYear() - 1]) {
    const d = new Date(y, month, day);
    if (d.getMonth() !== month || d.getDate() !== day) continue;
    candidates.push(d);
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => Math.abs(a - ref) - Math.abs(b - ref));
  return {
    date: tgDateISO(candidates[0]),
    startMin: Number(m[4]) * 60 + Number(m[5]),
    endMin: Number(m[6]) * 60 + Number(m[7]),
  };
}

// Resolve each slot to its 30-minute cell instants (ms since epoch).
// Prefers slotCells; then slotTimes; then parses labels in q.tz.
// Returns [{label, cells: [ms...]}] or null (caller uses table fallback).
function resolveSlotCells(q, referenceDate) {
  const stepMs = RG_STEP * 60000;
  const out = [];
  for (const label of q.slots || []) {
    const stored = q.slotCells && q.slotCells[label];
    if (Array.isArray(stored) && stored.length) {
      const cells = stored.map((s) => Date.parse(s));
      if (cells.some(isNaN)) return null;
      out.push({ label, cells });
      continue;
    }
    let start, end;
    const t = q.slotTimes && q.slotTimes[label];
    if (t && t.start && t.end) {
      start = Date.parse(t.start); end = Date.parse(t.end);
    } else {
      const p = parseSlotLabel(label, referenceDate);
      if (!p) return null;
      const zone = q.tz || localZone();
      start = zonedWallToUtc(p.date, p.startMin, zone);
      end = zonedWallToUtc(p.date, p.endMin, zone);
    }
    if (isNaN(start) || isNaN(end) || end <= start) return null;
    const cells = [];
    for (let ts = start; ts < end; ts += stepMs) cells.push(ts);
    out.push({ label, cells });
  }
  return out.length ? out : null;
}

// Build the paintable grid in the viewer's chosen timezone.
// Returns {element, getAnswers()} or null (use table fallback).
function createRespondentGrid(q, referenceDate, onChange, opts = {}) {
  const blocks = resolveSlotCells(q, referenceDate);
  if (!blocks) return null;
  const stepMs = RG_STEP * 60000;

  // Allowed cells: instant -> owning block label.
  const allowedAt = new Map();
  for (const b of blocks) for (const ts of b.cells) allowedAt.set(ts, b.label);

  const wrap = el("div", {});
  const chosen = new Set(); // instants (ms) the respondent painted
  let viewZone = localZone();
  // opts.readOnly: designer live preview — same look, no painting.
  const readOnly = !!opts.readOnly;

  const creatorZone = q.tz;
  const hint = el("div", { class: "hint" },
    readOnly
      ? "Preview: this is what respondents will see and paint."
      : "Highlighted cells are the candidate times. Drag a box over the times that work for you; click a selected cell to deselect it.");
  const tzSel = zoneSelect(viewZone, (z) => { viewZone = z; buildGrid(); });
  const tzRow = el("div", { class: "row", style: "margin:6px 0" },
    el("label", { class: "tg-ctl" }, "Show times in", tzSel));
  const zoneNote = el("div", { class: "hint" });
  const gridBox = el("div", {});
  const summary = el("div", { class: "hint" });

  let gridEl = null;
  let dragging = false;
  let anchor = null;   // {row, col} global row index / column
  let baseChosen = null;
  let rectMode = true;
  let layout = null;  // set by buildGrid: {rowMin, rowMax, rowInstant(r,c), rowsPerDay, crosses, dates}
  const paintState = {
    finish: () => { dragging = false; refreshSummary(); },
    abort: () => { dragging = false; },
  };

  function buildGrid() {
    // Place every allowed cell on the viewer's wall clock.
    const placed = []; // {ts, date, min, label}
    for (const [ts, label] of allowedAt) {
      const w = utcToZonedWall(ts, viewZone);
      placed.push({ ts, date: w.date, min: w.min, label });
    }
    const dates = [...new Set(placed.map((p) => p.date))].sort();
    const dateIndex = {};
    dates.forEach((d, i) => (dateIndex[d] = i));
    const rowsPerDay = (24 * 60) / RG_STEP;
    const crosses = placed.some((p) => {
      const end = utcToZonedWall(p.ts + stepMs, viewZone);
      return end.date !== p.date;
    });

    // Global row = dayIndex * rowsPerDay + min / step (crossing midnight
    // moves into the next day's rows). Window the display around the cells.
    const cellAt = {}; // "globalRow|col" -> {ts, label}
    let rowMin = Infinity, rowMax = -Infinity;
    for (const p of placed) {
      const gr = dateIndex[p.date] * rowsPerDay + p.min / RG_STEP;
      const col = dateIndex[p.date];
      cellAt[`${gr}|${col}`] = { ts: p.ts, label: p.label };
      if (gr < rowMin) rowMin = gr;
      if (gr + 1 > rowMax) rowMax = gr + 1;
    }
    rowMin = Math.max(0, rowMin - 1);
    rowMax = Math.min(dates.length * rowsPerDay, rowMax + 1);

    layout = { rowMin, rowMax, rowsPerDay, dates, cellAt };

    gridEl = el("div", { class: "tg-grid rg-grid" });
    gridEl.style.gridTemplateColumns = `56px repeat(${dates.length}, 1fr)`;
    gridEl.append(el("div", { class: "tg-corner" }));
    for (const iso of dates) {
      const d = tgParseISO(iso);
      gridEl.append(el("div", { class: "tg-head" },
        TG_DAYS[d.getDay()], el("div", {}, `${TG_MONTHS[d.getMonth()]} ${d.getDate()}`)));
    }
    for (let r = rowMin; r < rowMax; r++) {
      const m = (r % rowsPerDay) * RG_STEP;
      const hour = m % 60 === 0;
      gridEl.append(el("div", { class: "tg-time" }, hour ? tgFmtTime(m) : ""));
      for (let c = 0; c < dates.length; c++) {
        const hit = cellAt[`${r}|${c}`];
        gridEl.append(el("div", {
          class: "tg-cell rg-cell" + (hour ? " hour" : "") +
                 (hit ? " allowed" : "") + (hit && chosen.has(hit.ts) ? " chosen" : ""),
          "data-ts": hit ? String(hit.ts) : null,
          "data-row": String(r), "data-col": String(c),
        }));
      }
    }
    gridBox.replaceChildren(gridEl);
    if (!readOnly) attachPaint();

    const refInstant = placed.length ? placed[0].ts : Date.now();
    zoneNote.textContent = creatorZone && creatorZone !== viewZone
      ? `Times set by the organizer in ${creatorZone} (${zoneAbbr(creatorZone, new Date(refInstant))}), shown here in ${viewZone} (${zoneAbbr(viewZone, new Date(refInstant))}).`
      : `Times shown in ${viewZone} (${zoneAbbr(viewZone, new Date(refInstant))}).`;
    refreshSummary();
  }

  function blockStatus(b) {
    const n = b.cells.filter((ts) => chosen.has(ts)).length;
    return n === 0 ? "no" : n === b.cells.length ? "yes" : "maybe";
  }

  function refreshSummary() {
    const parts = blocks
      .map((b) => ({ b, s: blockStatus(b) }))
      .filter((x) => x.s !== "no")
      .map((x) => `${x.b.label}${x.s === "maybe" ? " (part)" : ""}`);
    summary.textContent = parts.length
      ? `You selected: ${parts.join(" \u00b7 ")}`
      : "Nothing selected yet.";
    if (onChange) onChange();
  }

  // Rectangle selection between anchor and current cell (when2meet-style).
  function applyRect(row, col) {
    const r0 = Math.min(anchor.row, row), r1 = Math.max(anchor.row, row);
    const c0 = Math.min(anchor.col, col), c1 = Math.max(anchor.col, col);
    chosen.clear();
    baseChosen.forEach((ts) => chosen.add(ts));
    for (const cell of gridEl.children) {
      if (!cell.getAttribute || !cell.getAttribute("data-ts")) continue;
      const cr = Number(cell.getAttribute("data-row"));
      const cc = Number(cell.getAttribute("data-col"));
      const ts = Number(cell.getAttribute("data-ts"));
      if (cr >= r0 && cr <= r1 && cc >= c0 && cc <= c1) {
        if (rectMode) chosen.add(ts); else chosen.delete(ts);
      }
      if (chosen.has(ts)) cell.classList.add("chosen");
      else cell.classList.remove("chosen");
    }
  }

  function attachPaint() {
    gridEl.addEventListener("pointerdown", (e) => {
      const cell = e.target.closest(".rg-cell");
      if (!cell || !cell.getAttribute("data-ts")) return;
      e.preventDefault();
      dragging = true;
      tgActivePaint = paintState;
      anchor = { row: Number(cell.getAttribute("data-row")), col: Number(cell.getAttribute("data-col")) };
      baseChosen = new Set(chosen);
      rectMode = !chosen.has(Number(cell.getAttribute("data-ts")));
      applyRect(anchor.row, anchor.col); // click = 1x1 rect = toggle
    });
    gridEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const cell = t && t.closest ? t.closest(".rg-cell") : null;
      if (cell && gridEl.contains(cell)) {
        applyRect(Number(cell.getAttribute("data-row")), Number(cell.getAttribute("data-col")));
      }
    });
  }

  wrap.append(hint, tzRow, zoneNote, gridBox, summary);
  buildGrid();
  return {
    element: wrap,
    // Block keys are the organizer's ORIGINAL labels. Exact painted instants
    // go under "<label> (parts)" so partial availability is recoverable.
    getAnswers: () => {
      const out = {};
      for (const b of blocks) {
        out[b.label] = blockStatus(b);
        const picked = b.cells.filter((ts) => chosen.has(ts));
        if (picked.length && picked.length < b.cells.length) {
          out[`${b.label} (parts)`] = picked.map((ts) => new Date(ts).toISOString());
        }
      }
      return out;
    },
  };
}