// when2meet-style drag-to-paint grid for choosing candidate meeting times.
// Cells are fixed 30-minute windows. Dragging selects the rectangular bounds
// between drag start and current pointer; a single click toggles one cell.
// Canonical output: q.slots (labels, answer keys) + q.slotCells (label ->
// UTC instants per 30-min cell) so respondents can paint cell-level overlap.
"use strict";

const TG_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TG_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const TG_STEP = 30; // minutes; harmonized on organizer and respondent sides

function tgDateISO(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Parse as LOCAL date (new Date("YYYY-MM-DD") would be UTC and can shift a day).
function tgParseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function tgFmtTime(min) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(min / 60))}:${p(min % 60)}`;
}

function tgSlotLabel(dateISO, startMin, endMin) {
  const d = tgParseISO(dateISO);
  return `${TG_DAYS[d.getDay()]} ${TG_MONTHS[d.getMonth()]} ${d.getDate()}, ` +
         `${tgFmtTime(startMin)}\u2013${tgFmtTime(endMin)}`;
}

// Merge consecutive painted cells (per date) into contiguous runs:
// [{date, start, end, label}] in chronological order.
function gridRunsFromSelection(grid) {
  const step = grid.step || TG_STEP;
  const byDate = {};
  for (const key of grid.selected || []) {
    const [date, m] = key.split("|");
    (byDate[date] = byDate[date] || []).push(Number(m));
  }
  const runs = [];
  for (const date of Object.keys(byDate).sort()) {
    const mins = [...new Set(byDate[date])].sort((a, b) => a - b);
    let start = mins[0], prev = mins[0];
    for (let i = 1; i <= mins.length; i++) {
      const m = mins[i];
      if (m !== undefined && m === prev + step) { prev = m; continue; }
      runs.push({ date, start, end: prev + step, label: tgSlotLabel(date, start, prev + step) });
      if (m !== undefined) { start = m; prev = m; }
    }
  }
  return runs;
}

function gridSlotsFromSelection(grid) {
  return gridRunsFromSelection(grid).map((r) => r.label);
}

// One global pointerup dispatcher; the editor being painted registers itself.
// (Per-editor window listeners would pile up stale closures on redraw.)
let tgActivePaint = null;
window.addEventListener("pointerup", () => {
  if (!tgActivePaint) return;
  const p = tgActivePaint;
  tgActivePaint = null;
  p.finish();
});

function defaultGrid() {
  // Next Monday.
  const d = new Date();
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
  return {
    startDate: tgDateISO(d),
    days: 5,
    startMin: 9 * 60,
    endMin: 17 * 60,
    step: TG_STEP,
    tz: localZone(),
    selected: [],
  };
}

// Build the editor DOM for a meeting question. onChange refreshes the preview.
function createTimeGridEditor(q, onChange) {
  if (!q.grid) {
    // Question created with the old line-based editor: keep its slots as
    // removable "custom" chips so editing doesn't silently discard them.
    if ((q.slots || []).length && !q.customSlots) q.customSlots = [...q.slots];
    q.grid = defaultGrid();
  }
  const grid = q.grid;
  if (!grid.tz) grid.tz = q.tz || localZone();
  // Harmonize any legacy 15/60-min grids to 30-minute windows.
  if (grid.step !== TG_STEP) {
    const snapped = new Set();
    for (const key of grid.selected || []) {
      const [date, m] = key.split("|");
      snapped.add(`${date}|${Math.floor(Number(m) / TG_STEP) * TG_STEP}`);
    }
    grid.selected = [...snapped];
    grid.step = TG_STEP;
  }
  const sel = new Set(grid.selected || []);

  const wrap = el("div", { style: "margin-top:8px" });
  const chipsBox = el("div", { class: "row", style: "margin:6px 0" });
  const gridBox = el("div", {});
  const info = el("div", { class: "hint" });

  function syncSlots() {
    grid.selected = [...sel];
    const runs = gridRunsFromSelection(grid);
    const generated = runs.map((r) => r.label);
    const custom = q.customSlots || [];
    q.slots = [...new Set([...custom, ...generated])];
    if (custom.length === 0) delete q.customSlots;
    // Labels stay the answer keys; slotCells gives the UTC instant of every
    // 30-min cell so respondents can select partial blocks.
    q.tz = grid.tz;
    const cells = {};
    for (const r of runs) {
      const arr = [];
      for (let m = r.start; m < r.end; m += TG_STEP) {
        arr.push(new Date(zonedWallToUtc(r.date, m, grid.tz)).toISOString());
      }
      cells[r.label] = arr;
    }
    if (Object.keys(cells).length) q.slotCells = cells;
    else delete q.slotCells;
    // Back-compat for respondents on older cached pages.
    const times = {};
    for (const r of runs) {
      times[r.label] = {
        start: new Date(zonedWallToUtc(r.date, r.start, grid.tz)).toISOString(),
        end: new Date(zonedWallToUtc(r.date, r.end, grid.tz)).toISOString(),
      };
    }
    if (Object.keys(times).length) q.slotTimes = times;
    else delete q.slotTimes;
    info.textContent = q.slots.length
      ? `${q.slots.length} time slot(s): ${q.slots.join(" \u00b7 ")}`
      : "Drag across the grid to select candidate times. Click a selected cell to deselect it.";
    drawChips();
    onChange();
  }

  function drawChips() {
    const chips = (q.customSlots || []).map((s, i) =>
      el("span", { class: "tg-chip" }, s,
        el("button", {
          class: "small", title: "Remove",
          onclick: () => { q.customSlots.splice(i, 1); syncSlots(); },
        }, "\u00d7"))
    );
    chipsBox.replaceChildren(...chips);
    chipsBox.style.display = chips.length ? "flex" : "none";
  }

  // --- controls ---
  const dateInput = el("input", { type: "date", value: grid.startDate });
  const daysInput = el("input", { type: "number", min: 1, max: 28, value: grid.days, style: "width:70px" });
  const halfHourOpts = (selected) => {
    const opts = [];
    for (let m = 0; m <= 24 * 60; m += TG_STEP) {
      const o = el("option", { value: String(m) }, tgFmtTime(m));
      if (m === selected) o.setAttribute("selected", "");
      opts.push(o);
    }
    return opts;
  };
  const startSel = el("select", { style: "width:auto" }, halfHourOpts(grid.startMin));
  const endSel = el("select", { style: "width:auto" }, halfHourOpts(grid.endMin));

  function controlsChanged() {
    grid.startDate = dateInput.value || grid.startDate;
    grid.days = Math.max(1, Math.min(28, Number(daysInput.value) || 5));
    grid.startMin = Number(startSel.value);
    grid.endMin = Number(endSel.value);
    if (grid.endMin <= grid.startMin) {
      grid.endMin = Math.min(24 * 60, grid.startMin + TG_STEP);
      endSel.value = String(grid.endMin);
    }
    buildGrid();
    syncSlots();
  }
  [dateInput, daysInput, startSel, endSel].forEach((c) =>
    c.addEventListener("change", controlsChanged)
  );

  // Timezone applies to the wall-clock times in the grid; changing it keeps
  // the painted cells but reinterprets them in the new zone.
  const tzSel = zoneSelect(grid.tz, (z) => { grid.tz = z; syncSlots(); });

  wrap.append(
    el("div", { class: "row tg-controls" },
      el("label", { class: "tg-ctl" }, "From date", dateInput),
      el("label", { class: "tg-ctl" }, "Days", daysInput),
      el("label", { class: "tg-ctl" }, "Start", startSel),
      el("label", { class: "tg-ctl" }, "End", endSel),
      el("label", { class: "tg-ctl" }, "Timezone", tzSel),
      el("button", {
        class: "small", type: "button",
        onclick: () => { sel.clear(); buildGrid(); syncSlots(); },
      }, "Clear")
    ),
    chipsBox,
    gridBox,
    info
  );

  // --- grid rendering ---
  let gridEl = null;
  let datesISO = [];
  function buildGrid() {
    const start = tgParseISO(grid.startDate);
    datesISO = [];
    for (let i = 0; i < grid.days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      datesISO.push(tgDateISO(d));
    }
    gridEl = el("div", { class: "tg-grid" });
    // Wide grids (up to 4 weeks) keep a minimum column width and scroll
    // horizontally instead of squeezing columns unreadably thin.
    const colW = grid.days > 10 ? "minmax(64px, 1fr)" : "1fr";
    gridEl.style.gridTemplateColumns = `56px repeat(${grid.days}, ${colW})`;

    gridEl.append(el("div", { class: "tg-corner" }));
    for (const iso of datesISO) {
      const d = tgParseISO(iso);
      gridEl.append(el("div", { class: "tg-head" },
        TG_DAYS[d.getDay()], el("div", {}, `${TG_MONTHS[d.getMonth()]} ${d.getDate()}`)));
    }
    for (let m = grid.startMin; m < grid.endMin; m += TG_STEP) {
      const hour = m % 60 === 0;
      gridEl.append(el("div", { class: "tg-time" }, hour ? tgFmtTime(m) : ""));
      for (let c = 0; c < datesISO.length; c++) {
        const key = `${datesISO[c]}|${m}`;
        gridEl.append(el("div", {
          class: "tg-cell" + (hour ? " hour" : "") + (sel.has(key) ? " sel" : ""),
          "data-key": key, "data-row": String(m), "data-col": String(c),
        }));
      }
    }
    gridBox.replaceChildren(gridEl);
    attachPaint();
  }

  // --- drag painting: rectangle bounds between anchor and current cell ---
  let dragging = false;
  let anchor = null; // {row, col}
  let baseSel = null; // selection snapshot at drag start
  let rectMode = true; // true = add rect, false = remove rect
  const paintState = {
    finish: () => { dragging = false; syncSlots(); },
    abort: () => { dragging = false; },
  };

  function applyRect(row, col) {
    const r0 = Math.min(anchor.row, row), r1 = Math.max(anchor.row, row);
    const c0 = Math.min(anchor.col, col), c1 = Math.max(anchor.col, col);
    sel.clear();
    baseSel.forEach((k) => sel.add(k));
    for (const cell of gridEl.children) {
      if (!cell.getAttribute) continue;
      const cr = Number(cell.getAttribute("data-row"));
      const cc = Number(cell.getAttribute("data-col"));
      if (!cell.getAttribute("data-key")) continue;
      const key = cell.getAttribute("data-key");
      if (cr >= r0 && cr <= r1 && cc >= c0 && cc <= c1) {
        if (rectMode) sel.add(key); else sel.delete(key);
      }
      if (sel.has(key)) cell.classList.add("sel");
      else cell.classList.remove("sel");
    }
  }

  function cellAt(x, y) {
    const t = document.elementFromPoint(x, y);
    const cell = t && t.closest ? t.closest(".tg-cell") : null;
    return cell && gridEl.contains(cell) ? cell : null;
  }

  function attachPaint() {
    gridEl.addEventListener("pointerdown", (e) => {
      const cell = e.target.closest(".tg-cell");
      if (!cell) return;
      e.preventDefault();
      dragging = true;
      tgActivePaint = paintState;
      anchor = { row: Number(cell.getAttribute("data-row")), col: Number(cell.getAttribute("data-col")) };
      baseSel = new Set(sel);
      rectMode = !sel.has(cell.getAttribute("data-key"));
      applyRect(anchor.row, anchor.col); // click = 1x1 rect = toggle
    });
    gridEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const cell = cellAt(e.clientX, e.clientY);
      if (cell) applyRect(Number(cell.getAttribute("data-row")), Number(cell.getAttribute("data-col")));
    });
  }

  wrap._tgPaintState = paintState;
  buildGrid();
  syncSlots();
  return wrap;
}