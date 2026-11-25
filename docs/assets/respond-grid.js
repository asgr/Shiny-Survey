// Respondent-side when2meet-style availability grid.
// Candidate slots render as highlighted blocks; the respondent drags over
// the blocks that work for them. Answers keep the ORIGINAL slot labels as
// keys (slot -> "yes"/"no"), so the Worker and R are unchanged regardless of
// which timezone the respondent views the grid in.
"use strict";

// Parse a generated slot label like "Mon Dec 7, 10:00–11:30" back into
// {date, startMin, endMin} (used only for surveys without slotTimes).
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

// Resolve each slot to UTC instants {start, end} (ms). Prefers the explicit
// slotTimes the designer stores; falls back to parsing labels in the
// survey's zone (q.tz) for older surveys. Returns null if any slot fails
// (hand-typed labels) — caller uses the table fallback.
function resolveSlotInstants(q, referenceDate) {
  const out = [];
  for (const label of q.slots || []) {
    const t = q.slotTimes && q.slotTimes[label];
    if (t && t.start && t.end) {
      const start = Date.parse(t.start), end = Date.parse(t.end);
      if (!isNaN(start) && !isNaN(end) && end > start) {
        out.push({ label, start, end });
        continue;
      }
    }
    const p = parseSlotLabel(label, referenceDate);
    if (!p) return null;
    const zone = q.tz || localZone();
    out.push({
      label,
      start: zonedWallToUtc(p.date, p.startMin, zone),
      end: zonedWallToUtc(p.date, p.endMin, zone),
    });
  }
  return out.length ? out : null;
}

// Build the paintable grid in the viewer's chosen timezone.
// Returns {element, getAnswers()} or null (use table fallback).
function createRespondentGrid(q, referenceDate, onChange) {
  const instants = resolveSlotInstants(q, referenceDate);
  if (!instants) return null;

  const wrap = el("div", {});
  const chosen = new Set(); // original slot labels
  let viewZone = localZone();

  const creatorZone = q.tz;
  const hint = el("div", { class: "hint" },
    "Highlighted blocks are the candidate times. Drag over the blocks that work for you; drag again to unselect.");
  const tzSel = zoneSelect(viewZone, (z) => { viewZone = z; buildGrid(); });
  const tzRow = el("div", { class: "row", style: "margin:6px 0" },
    el("label", { class: "tg-ctl" }, "Show times in", tzSel));
  const zoneNote = el("div", { class: "hint" });
  const gridBox = el("div", {});
  const summary = el("div", { class: "hint" });

  let gridEl = null;
  let dragging = false;
  let paintMode = true;
  const paintState = {
    finish: () => { dragging = false; refreshSummary(); },
    abort: () => { dragging = false; },
  };

  function buildGrid() {
    // Convert instants to the viewer's wall clock.
    const placed = instants.map((s) => {
      const a = utcToZonedWall(s.start, viewZone);
      const b = utcToZonedWall(s.end, viewZone);
      return { label: s.label, startDate: a.date, startMin: a.min, endDate: b.date, endMin: b.min };
    });
    // All dates the slots touch, including intermediate days for long spans.
    const dateSet = new Set();
    for (const p of placed) {
      let d = tgParseISO(p.startDate);
      const last = p.endDate;
      while (true) {
        const iso = tgDateISO(d);
        dateSet.add(iso);
        if (iso === last) break;
        d.setDate(d.getDate() + 1);
      }
    }
    const dates = [...dateSet].sort();
    const gcd = (a, b) => (b ? gcd(b, a % b) : a);
    let step = 0;
    for (const p of placed) {
      step = gcd(step, p.startMin);
      step = gcd(step, p.endMin);
    }
    if (step <= 0 || step > 60) step = 30;

    // Two layouts:
    // - usual: shared time-of-day rows across date columns (compact);
    // - midnight-crossing: per-day full columns so both sides of midnight
    //   are visible in the right date column.
    const crosses = placed.some((p) => p.startDate !== p.endDate);
    const rowsPerDay = (24 * 60) / step;
    const dateIndex = {};
    dates.forEach((d, i) => (dateIndex[d] = i));
    const cellSlot = {}; // "row|col" -> label
    let rowMin, rowMax, rowToCell;
    if (crosses) {
      rowMin = 0;
      rowMax = dates.length * rowsPerDay;
      rowToCell = (r, c) => (Math.floor(r / rowsPerDay) === c ? `${r % rowsPerDay}|${c}` : null);
      for (const p of placed) {
        let di = dateIndex[p.startDate], m = p.startMin;
        const lastDi = dateIndex[p.endDate];
        const endMin = p.endMin === 0 && p.endDate !== p.startDate ? 24 * 60 : p.endMin;
        while (di < lastDi || (di === lastDi && m < endMin)) {
          cellSlot[`${m / step}|${di}`] = p.label;
          m += step;
          if (m >= 24 * 60) { m = 0; di++; }
        }
      }
    } else {
      const minStart = Math.min(...placed.map((p) => p.startMin));
      const maxEnd = Math.max(...placed.map((p) => p.endMin));
      rowMin = Math.max(0, Math.floor(minStart / step) - 1);
      rowMax = Math.min(rowsPerDay, Math.ceil(maxEnd / step) + 1);
      rowToCell = (r, c) => `${r}|${c}`;
      for (const p of placed) {
        const c = dateIndex[p.startDate];
        for (let m = p.startMin; m < p.endMin; m += step) cellSlot[`${m / step}|${c}`] = p.label;
      }
    }

    gridEl = el("div", { class: "tg-grid rg-grid" });
    gridEl.style.gridTemplateColumns = `56px repeat(${dates.length}, 1fr)`;
    gridEl.append(el("div", { class: "tg-corner" }));
    for (const iso of dates) {
      const d = tgParseISO(iso);
      gridEl.append(el("div", { class: "tg-head" },
        TG_DAYS[d.getDay()], el("div", {}, `${TG_MONTHS[d.getMonth()]} ${d.getDate()}`)));
    }
    for (let r = rowMin; r < rowMax; r++) {
      const m = (r % rowsPerDay) * step;
      const hour = m % 60 === 0;
      gridEl.append(el("div", { class: "tg-time" }, hour || step === 60 ? tgFmtTime(m) : ""));
      for (let c = 0; c < dates.length; c++) {
        const cellKey = rowToCell(r, c);
        const label = cellKey ? cellSlot[cellKey] : undefined;
        gridEl.append(el("div", {
          class: "tg-cell rg-cell" + (hour ? " hour" : "") +
                 (label ? " allowed" : "") + (label && chosen.has(label) ? " chosen" : ""),
          "data-slot": label || null,
        }));
      }
    }
    gridBox.replaceChildren(gridEl);
    attachPaint();

    zoneNote.textContent = creatorZone && creatorZone !== viewZone
      ? `Times set by the organizer in ${creatorZone} (${zoneAbbr(creatorZone, new Date(instants[0].start))}), shown here in ${viewZone} (${zoneAbbr(viewZone, new Date(instants[0].start))}).`
      : `Times shown in ${viewZone} (${zoneAbbr(viewZone, new Date(instants[0].start))}).`;
    refreshSummary();
  }

  function refreshSummary() {
    summary.textContent = chosen.size
      ? `You selected: ${[...chosen].join(" \u00b7 ")}`
      : "Nothing selected yet.";
    if (onChange) onChange();
  }

  function applyCell(cell) {
    const label = cell.getAttribute("data-slot");
    if (!label) return;
    if (paintMode) chosen.add(label);
    else chosen.delete(label);
    for (const c of gridEl.children) {
      if (c.getAttribute && c.getAttribute("data-slot") === label) {
        if (paintMode) c.classList.add("chosen");
        else c.classList.remove("chosen");
      }
    }
  }

  function attachPaint() {
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
  }

  wrap.append(hint, tzRow, zoneNote, gridBox, summary);
  buildGrid();
  return {
    element: wrap,
    // Keys are the organizer's ORIGINAL slot labels — timezone-independent.
    getAnswers: () => {
      const out = {};
      for (const s of instants) out[s.label] = chosen.has(s.label) ? "yes" : "no";
      return out;
    },
  };
}