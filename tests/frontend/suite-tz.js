function assert(n, c, extra) { print((c?"PASS ":"FAIL ")+n+(c?"":" -- "+extra)); if(!c) throw new Error(n); }
// AWST (UTC+8, no DST): Mon Dec 7 2026 10:00 Perth = 02:00 UTC
const ts = zonedWallToUtc("2026-12-07", 600, "Australia/Perth");
assert("Perth->UTC", ts === Date.UTC(2026, 11, 7, 2, 0), new Date(ts).toISOString());
// roundtrip into New York (UTC-5 in Dec): 02:00 UTC = Dec 6 21:00
const ny = utcToZonedWall(ts, "America/New_York");
assert("UTC->NY date", ny.date === "2026-12-06", JSON.stringify(ny));
assert("UTC->NY time", ny.min === 21 * 60, ny.min);
// roundtrip back to Perth
const back = utcToZonedWall(ts, "Australia/Perth");
assert("roundtrip", back.date === "2026-12-07" && back.min === 600);
// NY wall time back to UTC equals same instant
assert("NY->UTC same instant", zonedWallToUtc(ny.date, ny.min, "America/New_York") === ts);
// DST edge: US spring-forward 2026-03-08, 1:30 EST -> 06:30 UTC; 3:30 EDT -> 07:30 UTC
const pre = zonedWallToUtc("2026-03-08", 90, "America/New_York");
const post = zonedWallToUtc("2026-03-08", 210, "America/New_York");
assert("DST pre", pre === Date.UTC(2026, 2, 8, 6, 30), new Date(pre).toISOString());
assert("DST post", post === Date.UTC(2026, 2, 8, 7, 30), new Date(post).toISOString());
// offsets
assert("Perth offset", zoneOffsetMinutes(new Date(ts), "Australia/Perth") === 480);
assert("NY Dec offset", zoneOffsetMinutes(new Date(ts), "America/New_York") === -300);
assert("zoneList includes local+UTC", zoneList().some(z => z.value === "UTC") && zoneList().some(z => z.value === localZone()));
print("tz tests OK");
