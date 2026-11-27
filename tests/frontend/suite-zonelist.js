function assert(n, c, extra) { print((c?"PASS ":"FAIL ")+n+(c?"":" -- "+extra)); if(!c) throw new Error(n); }
const list = zoneList();
print("first 6:", list.slice(0, 6).map(z => z.label).join(" | "));
assert("local first", list[0].value === localZone() && list[0].label.includes("(local)"));
const utcIdx = list.findIndex(z => z.value === "UTC");
assert("UTC right after local (when local != UTC)", localZone() === "UTC" || utcIdx === 1);
assert("UTC labeled UTC/GMT", list[utcIdx].label === "UTC/GMT");
// fixed offsets ascending -12..+14
const fixed = list.filter(z => z.value.startsWith("Etc/GMT"));
const offs = fixed.map(z => { const m = z.label.match(/UTC\/GMT([+-]\d+)/); return Number(m[1]); });
assert("offsets ascending", offs.every((v, i) => i === 0 || v > offs[i-1]), JSON.stringify(offs));
assert("starts -12 ends +14", offs[0] === -12 && offs[offs.length-1] === 14, JSON.stringify(offs));
assert("sign correct: Etc/GMT-8 labeled +8", list.find(z => z.value === "Etc/GMT-8").label === "UTC/GMT+8");
assert("sign correct: Etc/GMT+5 labeled -5", list.find(z => z.value === "Etc/GMT+5").label === "UTC/GMT-5");
assert("no other Etc noise", list.every(z => !z.value.startsWith("Etc/") || z.value.startsWith("Etc/GMT")));
assert("named zones present", list.some(z => z.value === "Australia/Perth") && list.some(z => z.value === "Europe/London"));
assert("no duplicates", new Set(list.map(z => z.value)).size === list.length);
// actual offset sanity: Etc/GMT-8 is UTC+8
assert("Etc/GMT-8 offset +480", zoneOffsetMinutes(new Date(), "Etc/GMT-8") === 480);
print("zonelist tests OK");
