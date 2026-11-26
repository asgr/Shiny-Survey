// Timezone helpers shared by the designer grid and respondent grid.
// Uses the built-in Intl API — no libraries, no DST math by hand.
"use strict";

function localZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

// Ordered zone list for the selector: local first, then UTC/GMT, then
// fixed-offset zones from -12 to +14 (ascending), then all named IANA
// zones alphabetically. Entries are {value, label}.
function zoneList() {
  let zones;
  try { zones = Intl.supportedValuesOf("timeZone"); }
  catch (e) { zones = ["UTC"]; }
  const local = localZone();
  const out = [{ value: local, label: `${local} (local)` }];
  const seen = new Set([local]);
  function add(value, label) {
    if (seen.has(value)) return;
    seen.add(value);
    out.push({ value, label: label || value });
  }
  add("UTC", "UTC/GMT");
  // Fixed offsets, ascending. IANA's Etc/GMT signs are INVERTED
  // (Etc/GMT+5 means UTC-5), so construct the label from the real offset.
  // Intl.supportedValuesOf omits Etc/*, but the zones are still valid —
  // probe one to confirm support before offering the range.
  let etcSupported = true;
  try { new Intl.DateTimeFormat("en-US", { timeZone: "Etc/GMT-8" }); }
  catch (e) { etcSupported = false; }
  if (etcSupported) {
    for (let off = -12; off <= 14; off++) {
      if (off === 0) continue; // covered by UTC/GMT
      const etc = `Etc/GMT${off > 0 ? "-" : "+"}${Math.abs(off)}`;
      add(etc, `UTC/GMT${off > 0 ? "+" : "-"}${Math.abs(off)}`);
    }
  }
  for (const z of zones) {
    if (z.startsWith("Etc/")) continue; // remaining Etc/* aliases are noise
    add(z);
  }
  return out;
}

// Offset (minutes) of `zone` at instant `date`: zoneWallClock - UTC.
function zoneOffsetMinutes(date, zone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

// Wall-clock time in `zone` (dateISO "YYYY-MM-DD", minutes since midnight)
// -> UTC epoch ms. Two-pass offset correction handles DST boundaries.
function zonedWallToUtc(dateISO, minutes, zone) {
  const [y, mo, d] = dateISO.split("-").map(Number);
  const naive = Date.UTC(y, mo - 1, d) + minutes * 60000;
  let ts = naive - zoneOffsetMinutes(new Date(naive), zone) * 60000;
  ts = naive - zoneOffsetMinutes(new Date(ts), zone) * 60000;
  return ts;
}

// UTC epoch ms -> wall-clock in `zone`: {date: "YYYY-MM-DD", min: minutes}.
function utcToZonedWall(ts, zone) {
  const shifted = new Date(ts + zoneOffsetMinutes(new Date(ts), zone) * 60000);
  const p = (n) => String(n).padStart(2, "0");
  return {
    date: `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`,
    min: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

// Short zone label for display, e.g. "GMT+8" / "GMT-5".
function zoneAbbr(zone, atDate) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, timeZoneName: "shortOffset",
    }).formatToParts(atDate || new Date());
    const tz = parts.find((p) => p.type === "timeZoneName");
    return tz ? tz.value : zone;
  } catch (e) { return zone; }
}

// A <select> of timezones with `selected` chosen.
function zoneSelect(selected, onChange) {
  const sel = document.createElement("select");
  sel.setAttribute("style", "width:auto; max-width:220px");
  for (const z of zoneList()) {
    const o = document.createElement("option");
    o.setAttribute("value", z.value);
    if (z.value === selected) o.setAttribute("selected", "");
    o.append(document.createTextNode(z.label));
    sel.append(o);
  }
  sel.value = selected;
  if (onChange) sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}