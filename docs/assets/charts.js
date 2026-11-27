// Minimal SVG charts for the results page. No dependencies.
// Horizontal bars are used throughout: labels stay readable even for
// long meeting-slot names, and they work on narrow screens.
"use strict";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined && v !== null) node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}

// items: [{label, value, color?, names?}] — one horizontal bar per item.
// max: scale maximum (defaults to largest value). names appear in tooltips.
function namesSuffix(names) {
  return names && names.length ? ` — ${names.join(", ")}` : "";
}
function hbarChart(items, { max, width = 560, barH = 22, gap = 6, labelW = 210, color = "#2563eb" } = {}) {
  if (!items.length) return el("p", { class: "hint" }, "No data to chart yet.");
  const scaleMax = Math.max(max || 0, ...items.map((d) => d.value), 1);
  const plotW = width - labelW - 46;
  const height = items.length * (barH + gap) + 8;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`, width: "100%",
    style: `max-width:${width}px; display:block`, role: "img",
  });
  items.forEach((d, i) => {
    const y = 4 + i * (barH + gap);
    const w = Math.max(d.value > 0 ? 2 : 0, (d.value / scaleMax) * plotW);
    svg.append(
      svgEl("text", {
        x: labelW - 8, y: y + barH / 2 + 4, "text-anchor": "end",
        "font-size": 12, fill: "#1c2733",
      }, d.label.length > 34 ? d.label.slice(0, 33) + "\u2026" : d.label),
      svgEl("rect", { x: labelW, y, width: plotW, height: barH, fill: "#eef2f6", rx: 3 }),
      svgEl("rect", { x: labelW, y, width: w, height: barH, fill: d.color || color, rx: 3 },
        svgEl("title", {}, `${d.label}: ${d.value}${namesSuffix(d.names)}`)),
      svgEl("text", {
        x: labelW + plotW + 8, y: y + barH / 2 + 4, "font-size": 12, fill: "#5b6b7b",
      }, String(d.value))
    );
  });
  return svg;
}

// Stacked horizontal bars: items [{label, parts: [{value, color, name}]}].
function stackedBarChart(items, { max, width = 560, barH = 22, gap = 6, labelW = 210 } = {}) {
  if (!items.length) return el("p", { class: "hint" }, "No data to chart yet.");
  const totals = items.map((d) => d.parts.reduce((s, p) => s + p.value, 0));
  const scaleMax = Math.max(max || 0, ...totals, 1);
  const plotW = width - labelW - 46;
  const height = items.length * (barH + gap) + 8;
  const svg = svgEl("svg", {
    viewBox: `0 0 ${width} ${height}`, width: "100%",
    style: `max-width:${width}px; display:block`, role: "img",
  });
  items.forEach((d, i) => {
    const y = 4 + i * (barH + gap);
    svg.append(
      svgEl("text", {
        x: labelW - 8, y: y + barH / 2 + 4, "text-anchor": "end",
        "font-size": 12, fill: "#1c2733",
      }, d.label.length > 34 ? d.label.slice(0, 33) + "\u2026" : d.label),
      svgEl("rect", { x: labelW, y, width: plotW, height: barH, fill: "#eef2f6", rx: 3 })
    );
    let x = labelW;
    for (const p of d.parts) {
      if (!p.value) continue;
      const w = (p.value / scaleMax) * plotW;
      svg.append(svgEl("rect", { x, y, width: w, height: barH, fill: p.color },
        svgEl("title", {}, `${d.label} — ${p.name}: ${p.value}${namesSuffix(p.names)}`)));
      x += w;
    }
    svg.append(svgEl("text", {
      x: labelW + plotW + 8, y: y + barH / 2 + 4, "font-size": 12, fill: "#5b6b7b",
    }, String(totals[i])));
  });
  return svg;
}

// Small legend row for stacked charts.
function chartLegend(entries) {
  return el("div", { class: "row", style: "margin:4px 0 8px" },
    entries.map((e) =>
      el("span", { class: "row", style: "gap:4px; font-size:0.8rem; color:#5b6b7b" },
        el("span", { style: `width:10px;height:10px;border-radius:2px;background:${e.color};display:inline-block` }),
        e.name)));
}

// Responses over time: one bar per day (local time of the viewer).
function responsesOverTime(responses, { width = 560 } = {}) {
  if (responses.length < 2) return null;
  const byDay = {};
  for (const r of responses) {
    const d = new Date(r.submittedAt);
    if (isNaN(d)) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    byDay[key] = (byDay[key] || 0) + 1;
  }
  const days = Object.keys(byDay).sort();
  if (days.length < 2) return null; // single burst: chart adds nothing
  const items = days.map((d) => ({ label: d, value: byDay[d] }));
  return el("div", {},
    el("h2", {}, "Responses over time"),
    hbarChart(items, { width, labelW: 110, color: "#5b6b7b" }),
    tallyTable(items.map((d) => [d.label, d.value]), ["Day", "Responses"]));
}