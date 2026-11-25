// Respondent-side when2meet-style availability grid.
// Candidate times render as highlighted 30-minute cells; the respondent
// clicks a block or drags a rectangle over the cells that work for them.
// Answers are BINARY per candidate block: any painted cells = "yes",
// none = "no". The exact chosen 30-min instants ride along in
// "<slot> (parts)" to power the availability heatmap.
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
  // opts.popularity: {total, counts: {iso: n}} — shade allowed cells by
  // how many current respondents are available then (aggregate only).
  const pop = opts.popularity || null;
  const popCounts = pop && pop.counts ? pop.counts : null;
  const popMax = popCounts ? Math.max(1, ...Object.values(popCounts)) : 0;
  function cellCount(ts) {
    return popCounts ? (popCounts[new Date(ts).toISOString()] || 0) : 0;
  }
  function cellAlpha(ts) {
    if (!popCounts) return 1;
    // faint for least popular, opaque for most; keep a visible floor
    return 0.15 + 0.85 * (cellCount(ts) / popMax);
  }

  const creatorZone = q.tz;
  const hint = el("div", { class: "hint" },
    readOnly
      ? "Preview: this is what respondents will see and paint."
      : "Click a highlighted block if that time works (click again to deselect). Only part of it works? Drag across just the 30-minute cells you can do — any painted time counts as available.");
  const tzSel = zoneSelect(viewZone, (z) => { viewZone = z; buildGrid(); });
  const tzRow = el("div", { class: "row", style: "margin:6px 0" },
    el("label", { class: "tg-ctl" }, "Show times in", tzSel));
  const zoneNote = el("div", { class: "hint" });
  const popNote = el("div", { class: "hint" });
  if (pop && !readOnly) {
    if (pop.total === 0) {
      popNote.textContent = "No responses yet — you're the first!";
    } else {
      // Min/max across ALL candidate cells (unpopular cells may be absent
      // from counts), so the range reflects the whole offered window.
      const allCounts = blocks.flatMap((b) => b.cells.map(cellCount));
      const lo = Math.min(...allCounts), hi = Math.max(...allCounts);
      popNote.textContent =
        `${pop.total} ${pop.total === 1 ? "person has" : "people have"} responded so far. ` +
        `Availability across the offered times ranges from ${lo} to ${hi} ` +
        `${hi === 1 ? "person" : "people"} per 30-min window. ` +
        "Stronger blue = more people available then; your green selection keeps the same shading so you can see the overlap. Hover a cell for its exact count.";
    }
  }
  const gridBox = el("div", {});
  const summary = el("div", { class: "hint" });

  let gridEl = null;
  let dragging = false;
  let anchor = null;   // {row, col} global row index / column
  let baseChosen = null;
  let rectMode = true;
  let moved = false;       // did the pointer leave the anchor cell?
  let downBlock = null;    // block label under pointerdown (for click=block)
  let layout = null;  // set by buildGrid: {rowMin, rowMax, rowInstant(r,c), rowsPerDay, crosses, dates}
  const paintState = {
    finish: () => {
      if (dragging && !moved && downBlock) toggleBlock(downBlock);
      dragging = false;
      refreshSummary();
    },
    abort: () => { dragging = false; },
  };

  // Apply chosen/unchoosen look to one cell, keeping popularity alpha.
  function paintCellLook(cell, ts) {
    if (chosen.has(ts)) cell.classList.add("chosen");
    else cell.classList.remove("chosen");
    if (popCounts) {
      const a = cellAlpha(ts);
      cell.style.background = chosen.has(ts)
        ? `rgba(34, 160, 107, ${a})`
        : `rgba(76, 141, 255, ${a})`;
    }
  }

  // Click (no drag) toggles the WHOLE candidate block: the common case is
  // "this session works / doesn't". Dragging paints exact 30-min cells.
  function toggleBlock(label) {
    const b = blocks.find((x) => x.label === label);
    if (!b) return;
    const fullyChosen = b.cells.every((ts) => chosen.has(ts));
    for (const ts of b.cells) {
      if (fullyChosen) chosen.delete(ts); else chosen.add(ts);
    }
    for (const cell of gridEl.children) {
      if (!cell.getAttribute || !cell.getAttribute("data-ts")) continue;
      const ts = Number(cell.getAttribute("data-ts"));
      if (!b.cells.includes(ts)) continue;
      paintCellLook(cell, ts);
    }
  }

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

    // Rows are TIME-OF-DAY slots shared by all date columns (like when2meet):
    // row = minuteOfDay / step, column = date. A cell that crosses midnight
    // in the viewer's zone simply appears late in one day's column and early
    // in the next day's column at the matching clock times.
    const cellAt = {}; // "row|col" -> {ts, label}
    let rowMin = Infinity, rowMax = -Infinity;
    for (const p of placed) {
      const row = p.min / RG_STEP;
      const col = dateIndex[p.date];
      cellAt[`${row}|${col}`] = { ts: p.ts, label: p.label };
      if (row < rowMin) rowMin = row;
      if (row + 1 > rowMax) rowMax = row + 1;
    }
    rowMin = Math.max(0, rowMin - 1);
    rowMax = Math.min(rowsPerDay, rowMax + 1);

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
      const m = r * RG_STEP;
      const hour = m % 60 === 0;
      gridEl.append(el("div", { class: "tg-time" }, hour ? tgFmtTime(m) : ""));
      for (let c = 0; c < dates.length; c++) {
        const hit = cellAt[`${r}|${c}`];
        const cell = el("div", {
          class: "tg-cell rg-cell" + (hour ? " hour" : "") +
                 (hit ? " allowed" : "") + (hit && chosen.has(hit.ts) ? " chosen" : ""),
          "data-ts": hit ? String(hit.ts) : null,
          "data-row": String(r), "data-col": String(c),
          title: hit && popCounts && !readOnly
            ? `${cellCount(hit.ts)} of ${pop.total} available ${tgFmtTime(m)}\u2013${tgFmtTime(m + RG_STEP)}`
            : null,
        });
        if (hit && popCounts) {
          // Inline background overrides the .allowed/.chosen CSS; both
          // states share the popularity alpha so overlap stays visible.
          const a = cellAlpha(hit.ts);
          cell.style.background = chosen.has(hit.ts)
            ? `rgba(34, 160, 107, ${a})`
            : `rgba(76, 141, 255, ${a})`;
        }
        gridEl.append(cell);
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

  // Binary availability: any painted cell in the window = available.
  function blockStatus(b) {
    return b.cells.some((ts) => chosen.has(ts)) ? "yes" : "no";
  }

  function refreshSummary() {
    const parts = blocks
      .filter((b) => blockStatus(b) === "yes")
      .map((b) => {
        const n = b.cells.filter((ts) => chosen.has(ts)).length;
        return n < b.cells.length ? `${b.label} (${n * 30} min)` : b.label;
      });
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
      paintCellLook(cell, ts);
    }
  }

  function attachPaint() {
    gridEl.addEventListener("pointerdown", (e) => {
      const cell = e.target.closest(".rg-cell");
      if (!cell) return;
      e.preventDefault();
      dragging = true;
      moved = false;
      tgActivePaint = paintState;
      anchor = { row: Number(cell.getAttribute("data-row")), col: Number(cell.getAttribute("data-col")) };
      baseChosen = new Set(chosen);
      const ts = cell.getAttribute("data-ts");
      downBlock = ts ? allowedAt.get(Number(ts)) : null;
      // Drag mode decided by anchor state: unselected/partial -> select,
      // fully-chosen block or chosen cell -> erase.
      if (downBlock) {
        const b = blocks.find((x) => x.label === downBlock);
        rectMode = !b.cells.every((t) => chosen.has(t));
      } else {
        rectMode = true;
      }
      // No visual change yet: a plain click toggles the whole block on
      // pointerup; the first pointermove starts cell-level rect painting.
    });
    gridEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const cell = t && t.closest ? t.closest(".rg-cell") : null;
      if (cell && gridEl.contains(cell)) {
        const r = Number(cell.getAttribute("data-row"));
        const c = Number(cell.getAttribute("data-col"));
        if (!moved && r === anchor.row && c === anchor.col) return;
        moved = true;
        applyRect(r, c);
      }
    });
  }

  wrap.append(hint, tzRow, zoneNote, popNote, gridBox, summary);
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