// Timezone helpers shared by the designer grid and respondent grid.
// Uses the built-in Intl API — no libraries, no DST math by hand.
"use strict";

function localZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function zoneList() {
  let zones;
  try { zones = Intl.supportedValuesOf("timeZone"); }
  catch (e) { zones = ["UTC"]; }
  const local = localZone();
  const common = ["UTC", "Pacific/Auckland", "Australia/Sydney", "Australia/Perth",
    "Asia/Tokyo", "Asia/Shanghai", "Asia/Singapore", "Asia/Kolkata",
    "Europe/London", "Europe/Paris", "Europe/Berlin",
    "America/New_York", "America/Chicago", "America/Denver",
    "America/Los_Angeles", "America/Sao_Paulo"];
  const ordered = [...new Set([local, ...common.filter((z) => zones.includes(z) || z === "UTC"), ...zones])];
  return ordered;
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
    o.setAttribute("value", z);
    if (z === selected) o.setAttribute("selected", "");
    o.append(document.createTextNode(z));
    sel.append(o);
  }
  sel.value = selected;
  if (onChange) sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}