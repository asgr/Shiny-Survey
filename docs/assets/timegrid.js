// when2meet-style drag-to-paint grid for choosing candidate meeting times.
// The grid is only an editor: the canonical output is q.slots (string list),
// so the respondent page, Worker, and R reader are unchanged.
"use strict";

const TG_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TG_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                   "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

// Merge consecutive painted cells (per date) into contiguous time ranges.
function gridSlotsFromSelection(grid) {
  const byDate = {};
  for (const key of grid.selected || []) {
    const [date, m] = key.split("|");
    (byDate[date] = byDate[date] || []).push(Number(m));
  }
  const slots = [];
  for (const date of Object.keys(byDate).sort()) {
    const mins = [...new Set(byDate[date])].sort((a, b) => a - b);
    let start = mins[0], prev = mins[0];
    for (let i = 1; i <= mins.length; i++) {
      const m = mins[i];
      if (m !== undefined && m === prev + grid.step) { prev = m; continue; }
      slots.push(tgSlotLabel(date, start, prev + grid.step));
      if (m !== undefined) { start = m; prev = m; }
    }
  }
  return slots;
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
    step: 30,
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
  const sel = new Set(grid.selected || []);

  const wrap = el("div", { style: "margin-top:8px" });
  const chipsBox = el("div", { class: "row", style: "margin:6px 0" });
  const gridBox = el("div", {});
  const info = el("div", { class: "hint" });

  function syncSlots() {
    grid.selected = [...sel];
    const generated = gridSlotsFromSelection(grid);
    const custom = q.customSlots || [];
    q.slots = [...new Set([...custom, ...generated])];
    if (custom.length === 0) delete q.customSlots;
    info.textContent = q.slots.length
      ? `${q.slots.length} time slot(s): ${q.slots.join(" \u00b7 ")}`
      : "Drag across the grid to select candidate times. Drag over selected cells to erase.";
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
  const daysInput = el("input", { type: "number", min: 1, max: 14, value: grid.days, style: "width:70px" });
  const hourOpts = (selected) => {
    const opts = [];
    for (let h = 0; h <= 24; h++) {
      const o = el("option", { value: String(h * 60) }, tgFmtTime(h * 60));
      if (h * 60 === selected) o.setAttribute("selected", "");
      opts.push(o);
    }
    return opts;
  };
  const startSel = el("select", { style: "width:auto" }, hourOpts(grid.startMin));
  const endSel = el("select", { style: "width:auto" }, hourOpts(grid.endMin));
  const stepSel = el("select", { style: "width:auto" },
    [15, 30, 60].map((s) => {
      const o = el("option", { value: String(s) }, `${s} min`);
      if (s === grid.step) o.setAttribute("selected", "");
      return o;
    })
  );

  function controlsChanged() {
    grid.startDate = dateInput.value || grid.startDate;
    grid.days = Math.max(1, Math.min(14, Number(daysInput.value) || 5));
    grid.startMin = Number(startSel.value);
    grid.endMin = Number(endSel.value);
    if (grid.endMin <= grid.startMin) {
      grid.endMin = Math.min(24 * 60, grid.startMin + 60);
      endSel.value = String(grid.endMin);
    }
    const oldStep = grid.step;
    grid.step = Number(stepSel.value);
    if (grid.step !== oldStep) {
      // Re-snap selections to the new step so they stay visible/editable.
      const snapped = new Set();
      for (const key of sel) {
        const [date, m] = key.split("|");
        snapped.add(`${date}|${Math.floor(Number(m) / grid.step) * grid.step}`);
      }
      sel.clear();
      snapped.forEach((k) => sel.add(k));
    }
    buildGrid();
    syncSlots();
  }
  [dateInput, daysInput, startSel, endSel, stepSel].forEach((c) =>
    c.addEventListener("change", controlsChanged)
  );

  wrap.append(
    el("div", { class: "row tg-controls" },
      el("label", { class: "tg-ctl" }, "From date", dateInput),
      el("label", { class: "tg-ctl" }, "Days", daysInput),
      el("label", { class: "tg-ctl" }, "Start", startSel),
      el("label", { class: "tg-ctl" }, "End", endSel),
      el("label", { class: "tg-ctl" }, "Step", stepSel),
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
  function buildGrid() {
    const start = tgParseISO(grid.startDate);
    const dates = [];
    for (let i = 0; i < grid.days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dates.push(d);
    }
    gridEl = el("div", { class: "tg-grid" });
    gridEl.style.gridTemplateColumns = `56px repeat(${grid.days}, 1fr)`;

    gridEl.append(el("div", { class: "tg-corner" }));
    for (const d of dates) {
      gridEl.append(el("div", { class: "tg-head" },
        TG_DAYS[d.getDay()], el("div", {}, `${TG_MONTHS[d.getMonth()]} ${d.getDate()}`)));
    }
    for (let m = grid.startMin; m < grid.endMin; m += grid.step) {
      const hour = m % 60 === 0;
      gridEl.append(el("div", { class: "tg-time" }, hour || grid.step === 60 ? tgFmtTime(m) : ""));
      for (const d of dates) {
        const key = `${tgDateISO(d)}|${m}`;
        const cell = el("div", {
          class: "tg-cell" + (hour ? " hour" : "") + (sel.has(key) ? " sel" : ""),
          "data-key": key,
        });
        gridEl.append(cell);
      }
    }
    gridBox.replaceChildren(gridEl);
    attachPaint();
  }

  // --- drag painting (mouse + touch via pointer events) ---
  let dragging = false;
  let paintMode = true; // true = select, false = erase (decided by first cell)
  // Detach from the global dispatcher if this editor is removed mid-drag.
  const paintState = {
    finish: () => { dragging = false; syncSlots(); },
    abort: () => { dragging = false; },
  };

  function applyCell(cell) {
    const key = cell.getAttribute("data-key");
    if (paintMode) { sel.add(key); cell.classList.add("sel"); }
    else { sel.delete(key); cell.classList.remove("sel"); }
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
      paintMode = !sel.has(cell.getAttribute("data-key"));
      applyCell(cell);
    });
    gridEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const cell = cellAt(e.clientX, e.clientY);
      if (cell) applyCell(cell);
    });
  }

  wrap._tgPaintState = paintState;
  buildGrid();
  syncSlots();
  return wrap;
}