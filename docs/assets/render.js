// Question rendering shared by the respondent page and the designer preview.
"use strict";

// opts.grid: render meeting questions as a paintable availability grid
// (respondent page); the designer preview keeps the simple table.
function renderQuestion(q, index, opts = {}) {
  const name = `q_${q.id}`;
  const label = el(
    "div", { class: "q-label" },
    `${index + 1}. ${q.label || "(untitled question)"}`,
    q.required ? el("span", { class: "required-mark" }, " *") : null
  );
  const box = el("div", { class: "question", "data-qid": q.id });
  box.append(label);

  if (q.type === "text" || q.type === "longtext") {
    const max = q.maxChars || (q.type === "text" ? 140 : 5000);
    const input = q.type === "text"
      ? el("input", { type: "text", name, maxlength: max })
      : el("textarea", { name, rows: 4, maxlength: max });
    const counter = el("div", { class: "hint" }, `0 / ${max} characters`);
    input.addEventListener("input", () => {
      const n = input.value.length;
      counter.textContent = `${n} / ${max} characters`;
      counter.style.color = n >= max ? "var(--danger)" : "";
    });
    box.append(input, counter);
  } else if (q.type === "single" || q.type === "yesno" || q.type === "multi") {
    const opts = q.type === "yesno" ? (q.options || ["Yes", "No"]) : (q.options || []);
    if (q.type === "multi" || !q.dropdown) {
      const inputType = q.type === "multi" ? "checkbox" : "radio";
      for (const opt of opts) {
        box.append(
          el("label", { class: "option" },
            el("input", { type: inputType, name, value: opt }), el("span", {}, opt))
        );
      }
    } else {
      // Dropdown: same single-choice data model, compact for long lists.
      const sel = el("select", { name });
      sel.append(el("option", { value: "" }, "— choose —"));
      for (const opt of opts) sel.append(el("option", { value: opt }, opt));
      box.append(sel);
    }
  } else if (q.type === "number") {
    const attrs = { type: "number", name, step: "any", style: "max-width:180px" };
    if (q.min !== undefined && q.min !== null) attrs.min = q.min;
    if (q.max !== undefined && q.max !== null) attrs.max = q.max;
    box.append(el("input", attrs));
    if (q.min != null || q.max != null) {
      box.append(el("div", { class: "hint" },
        `Allowed range: ${q.min ?? "−∞"} to ${q.max ?? "+∞"}`));
    }
  } else if (q.type === "likert") {
    const cols = q.scale || ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];
    const table = el("table", { class: "grid" });
    table.append(el("tr", {}, el("th", {}, ""), cols.map((c) => el("th", {}, c))));
    (q.rows || []).forEach((rowLabel, i) => {
      const rowName = `${name}__${i}`;
      table.append(
        el("tr", {},
          el("td", {}, rowLabel),
          cols.map((c) =>
            el("td", {}, el("input", { type: "radio", name: rowName, value: c, "data-row": rowLabel }))
          )
        )
      );
    });
    box.append(table);
  } else if (q.type === "rating") {
    const row = el("div", { class: "rating" });
    for (let v = 1; v <= 5; v++) {
      row.append(
        el("label", {}, el("input", { type: "radio", name, value: String(v) }), String(v))
      );
    }
    box.append(row, el("div", { class: "hint" }, "1 = lowest, 5 = highest"));
  } else if (q.type === "meeting") {
    if (opts.grid && q.display !== "list" && typeof createRespondentGrid === "function") {
      const rg = createRespondentGrid(q, opts.refDate, null, {
        readOnly: !!opts.readOnly,
        popularity: opts.popularity || null,
        viewLabel: opts.viewLabel,
      });
      if (rg) {
        box.append(rg.element);
        box._respondGrid = rg;
        return box;
      }
      // Unparseable (hand-typed) slots: fall through to the table.
    }
    const table = el("table", { class: "grid" });
    // Binary availability (legacy "maybe" choices are ignored).
    const cols = ["yes", "no"];
    table.append(
      el("tr", {}, el("th", {}, "Date / time"),
        el("th", {}, "available"), el("th", {}, "not available"))
    );
    (q.slots || []).forEach((slot, i) => {
      const slotName = `${name}__${i}`;
      table.append(
        el("tr", {},
          el("td", {}, slot),
          cols.map((c) =>
            el("td", {}, el("input", { type: "radio", name: slotName, value: c, "data-slot": slot }))
          )
        )
      );
    });
    box.append(table);
    // List mode on the respondent page: default all windows to "no" so
    // untouched rows mean not available (matches the grid's semantics).
    if (opts.grid && q.display === "list") {
      (q.slots || []).forEach((slot, i) => {
        const noInput = box.querySelector(`input[name="${name}__${i}"][value="no"]`);
        if (noInput) noInput.checked = true;
      });
      box.append(el("div", { class: "hint" },
        "Mark each window available or not. Untouched windows count as not available."));
    }
  }
  return box;
}