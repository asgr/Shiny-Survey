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

  if (q.type === "text") {
    box.append(el("input", { type: "text", name }));
  } else if (q.type === "longtext") {
    box.append(el("textarea", { name, rows: 4 }));
  } else if (q.type === "single" || q.type === "multi") {
    const inputType = q.type === "single" ? "radio" : "checkbox";
    for (const opt of q.options || []) {
      box.append(
        el("label", { class: "option" },
          el("input", { type: inputType, name, value: opt }), el("span", {}, opt))
      );
    }
  } else if (q.type === "rating") {
    const row = el("div", { class: "rating" });
    for (let v = 1; v <= 5; v++) {
      row.append(
        el("label", {}, el("input", { type: "radio", name, value: String(v) }), String(v))
      );
    }
    box.append(row, el("div", { class: "hint" }, "1 = lowest, 5 = highest"));
  } else if (q.type === "meeting") {
    if (opts.grid && typeof createRespondentGrid === "function") {
      const rg = createRespondentGrid(q, opts.refDate, null, {
        readOnly: !!opts.readOnly,
        popularity: opts.popularity || null,
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
  }
  return box;
}