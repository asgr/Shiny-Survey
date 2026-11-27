// Test harness: stubs Worker platform APIs, then loads the worker source
// (appended below by the build step), then runs the tests (appended last).

// ---- platform stubs ----
const console = { error: (...a) => print("console.error:", ...a), log: (...a) => print(...a) };

class URL {
  constructor(u) {
    this.href = u;
    const m = u.match(/^https?:\/\/[^/]+([^?#]*)/);
    this.pathname = m ? m[1] : "/";
    const q = u.split("?")[1] || "";
    const params = {};
    for (const kv of q.split("&")) {
      if (!kv) continue;
      const [k, v] = kv.split("=");
      params[decodeURIComponent(k)] = decodeURIComponent(v || "");
    }
    this.searchParams = { get: (k) => params[k] ?? null };
  }
}

class TextEncoder {
  encode(str) {
    const bin = unescape(encodeURIComponent(str));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
}

class TextDecoder {
  decode(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return decodeURIComponent(escape(bin));
  }
}

const B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function btoa(bin) {
  let out = "";
  for (let i = 0; i < bin.length; i += 3) {
    const a = bin.charCodeAt(i), b = bin.charCodeAt(i + 1), c = bin.charCodeAt(i + 2);
    out += B64CHARS[a >> 2];
    out += B64CHARS[((a & 3) << 4) | (isNaN(b) ? 0 : b >> 4)];
    out += isNaN(b) ? "=" : B64CHARS[((b & 15) << 2) | (isNaN(c) ? 0 : c >> 6)];
    out += isNaN(c) ? "=" : B64CHARS[c & 63];
  }
  return out;
}
function atob(b64) {
  const clean = b64.replace(/=+$/, "");
  let out = "", bits = 0, acc = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64CHARS.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((acc >> bits) & 0xff); }
  }
  return out;
}

const crypto = {
  // Deterministic stand-in for SHA-256; tests only need determinism + hex.
  subtle: {
    async digest(alg, bytes) {
      let h = 2166136261;
      for (let i = 0; i < bytes.length; i++) h = ((h ^ bytes[i]) * 16777619) >>> 0;
      const out = new Uint8Array(32);
      for (let i = 0; i < 32; i++) { h = ((h ^ (i + 1)) * 16777619) >>> 0; out[i] = h & 0xff; }
      return out.buffer;
    },
  },
  _uuidCounter: 0,
  randomUUID() { return `uuid-${++this._uuidCounter}`; },
};

class Headers {
  constructor(obj = {}) { this.map = {}; for (const k in obj) this.map[k.toLowerCase()] = obj[k]; }
  get(k) { return this.map[k.toLowerCase()] ?? null; }
}
class Response {
  constructor(body, init = {}) {
    this._body = body == null ? "" : String(body);
    this.status = init.status ?? 200;
    this.headers = new Headers(init.headers || {});
  }
  get ok() { return this.status >= 200 && this.status < 300; }
  async text() { return this._body; }
  async json() { return JSON.parse(this._body); }
}

// ---- in-memory GitHub ----
const store = {}; // file path -> decoded content
const fileMeta = {}; // file path -> API-style {content, encoding}
const dirs = {};  // dir path -> [{type:"file", name}]
const definitions = {}; // surveyId -> definition object
let putCount = 0;

async function fetch(url, opts = {}) {
  if (url.startsWith("https://raw.githubusercontent.com")) {
    const id = url.match(/surveys\/([^.]+)\.json/)[1];
    if (!definitions[id]) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(definitions[id]), { status: 200 });
  }
  const path = decodeURIComponent(url.match(/contents\/(.*)$/)[1]);
  const method = opts.method || "GET";
  if (method === "GET") {
    if (store[path] !== undefined) {
      return new Response(JSON.stringify(fileMeta[path] || { content: btoa(store[path]) }), { status: 200 });
    }
    if (dirs[path]) return new Response(JSON.stringify(dirs[path]), { status: 200 });
    return new Response("{}", { status: 404 });
  }
  if (method === "PUT") {
    putCount++;
    const body = JSON.parse(opts.body);
    if (store[path] !== undefined && !body.sha) return new Response("{}", { status: 422 });
    if (body.sha && store[path] === undefined) return new Response("{}", { status: 422 });
    store[path] = decodeURIComponent(escape(atob(body.content)));
    const parts = path.split("/");
    const dir = parts.slice(0, -1).join("/");
    dirs[dir] = dirs[dir] || [];
    if (!dirs[dir].some((e) => e.path === path)) {
      dirs[dir].push({ type: "file", name: parts[parts.length - 1], path });
    }
    // Mirror the real GitHub API: file GETs return {content, encoding}.
    fileMeta[path] = { content: body.content, encoding: "base64", sha: "sha-" + putCount };
    return new Response("{}", { status: 201 });
  }
  throw new Error("unexpected fetch " + method + " " + url);
}

const env = {
  GH_TOKEN: "test-token",
  IP_SALT: "test-salt",
  GH_OWNER: "tester",
  PRIVATE_REPO: "responses",
  PUBLIC_REPO: "site",
  ALLOWED_ORIGIN: "https://tester.github.io",
};

function req(method, path, body, headers = {}) {
  const h = { origin: env.ALLOWED_ORIGIN, "cf-connecting-ip": "203.0.113.7", ...headers };
  // Snapshot the body at request-creation time, like a real Request object.
  const bodyText = typeof body === "string" ? body : JSON.stringify(body);
  return {
    method,
    url: "https://worker.example" + path,
    headers: { get: (k) => h[k.toLowerCase()] ?? null },
    text: async () => bodyText,
  };
}

// ---- test helpers ----
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; print("PASS " + name); }
  else { failed++; print("FAIL " + name + (extra ? " -- " + extra : "")); }
}

const baseDef = {
  id: "testsurvey",
  title: "Test",
  open: true,
  collectName: false,
  dedup: "browser+ip",
  maxResponses: 3,
  questions: [
    { id: "q1", type: "single", label: "Pick", required: true, options: ["a", "b"] },
    { id: "q2", type: "multi", label: "Many", required: false, options: ["x", "y"] },
    { id: "q3", type: "rating", label: "Rate", required: false },
    { id: "q4", type: "meeting", label: "When", required: true, slots: ["Mon 10am", "Tue 2pm"], choices: ["yes", "no", "maybe"] },
    { id: "q5", type: "text", label: "Note", required: false },
  ],
};
definitions["testsurvey"] = baseDef;

const goodAnswers = {
  q1: "a", q2: ["x"], q3: "4",
  q4: { "Mon 10am": "yes", "Tue 2pm": "maybe" },
  q5: "hello",
};

async function submit(body, headers) {
  return worker.fetch(req("POST", "/submit", { surveyId: "testsurvey", token: "tok-AAA", answers: goodAnswers, ...body }, headers), env);
}