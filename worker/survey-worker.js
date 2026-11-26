/**
 * Survey receiver — Cloudflare Worker (free tier).
 *
 * Deploy: paste this file into a Worker in the Cloudflare dashboard.
 * Settings -> Variables and Secrets:
 *   GH_TOKEN      (secret)  fine-grained PAT, contents read/write on the PRIVATE responses repo
 *   IP_SALT       (secret)  long random string, e.g. output of `openssl rand -hex 32`
 *   GH_OWNER      (text)    your GitHub username
 *   PRIVATE_REPO  (text)    private repo name, e.g. survey-responses
 *   PUBLIC_REPO   (text)    public Pages repo name, e.g. Shiny-Survey
 *   ALLOWED_ORIGIN(text)    your Pages origin, e.g. https://USER.github.io
 *
 * Responses are stored at responses/<surveyId>/<dedupKey>.json in the private
 * repo. Only salted hashes of IPs / browser tokens are ever stored or used in
 * filenames — never raw IPs — so anonymous surveys stay anonymous.
 */

const GH_API = "https://api.github.com";
const MAX_BODY_BYTES = 32 * 1024;
const DEFINITION_TTL_MS = 60 * 1000;
const definitionCache = new Map(); // surveyId -> {survey, fetchedAt}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      if (origin !== "*" && request.headers.get("Origin") !== origin) {
        return new Response(null, { status: 403 });
      }
      return new Response(null, {
        status: 204,
        headers: { ...cors, "Access-Control-Allow-Headers": "Content-Type, X-Survey-Token" },
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "survey-worker" }, 200, cors);
    }

    // Cheap response count for the designer list: one directory listing,
    // no per-file reads. Public-safe (a bare integer).
    if (request.method === "GET" && url.pathname === "/count") {
      if (origin !== "*" && request.headers.get("Origin") !== origin) {
        return json({ error: "Forbidden origin" }, 403, cors);
      }
      try {
        return await handleCount(url, env, cors);
      } catch (err) {
        console.error("count failed:", err && err.message);
        return json({ error: "Unavailable" }, 500, cors);
      }
    }

    // Aggregate-only popularity for the respondent grid's shading.
    // Returns counts per 30-min cell — never names, answers, or ids.
    if (request.method === "GET" && url.pathname === "/popularity") {
      if (origin !== "*" && request.headers.get("Origin") !== origin) {
        return json({ error: "Forbidden origin" }, 403, cors);
      }
      try {
        return await handlePopularity(url, env, cors);
      } catch (err) {
        console.error("popularity failed:", err && err.message);
        return json({ error: "Unavailable" }, 500, cors);
      }
    }

    // Return the caller's OWN response, keyed by their browser token.
    // The client sends the token in a header (never a URL); the Worker
    // hashes it with IP_SALT to find the file. No token -> no lookup.
    if (request.method === "GET" && url.pathname === "/response") {
      if (origin !== "*" && request.headers.get("Origin") !== origin) {
        return json({ error: "Forbidden origin" }, 403, cors);
      }
      try {
        return await handleResponse(request, url, env, cors);
      } catch (err) {
        console.error("response lookup failed:", err && err.message);
        return json({ error: "Unavailable" }, 500, cors);
      }
    }

    if (request.method === "POST" && url.pathname === "/submit") {
      if (origin !== "*" && request.headers.get("Origin") !== origin) {
        return json({ error: "Forbidden origin" }, 403, cors);
      }
      try {
        return await handleSubmit(request, env, cors);
      } catch (err) {
        // Do not leak internals (tokens, URLs) to respondents.
        console.error("submit failed:", err && err.message);
        return json({ error: "Internal error, please try again later." }, 500, cors);
      }
    }

    return json({ error: "Not found" }, 404, cors);
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function sha256Hex(str) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function getDefinition(env, surveyId) {
  const cached = definitionCache.get(surveyId);
  if (cached && Date.now() - cached.fetchedAt < DEFINITION_TTL_MS) return cached.survey;
  // Cache-buster: raw.githubusercontent.com caches ~5 min server-side;
  // a unique query string forces a fresh read so edits apply immediately.
  const res = await fetch(
    `https://raw.githubusercontent.com/${env.GH_OWNER}/${env.PUBLIC_REPO}/main/docs/surveys/${surveyId}.json?t=${Date.now()}`,
    { cf: { cacheTtl: 0 } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`definition fetch ${res.status}`);
  const survey = await res.json();
  definitionCache.set(surveyId, { survey, fetchedAt: Date.now() });
  return survey;
}

// Validate and normalize answers against the definition. Returns
// {answers} on success or {error} on failure. Unknown question ids are dropped.
function validateAnswers(survey, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Invalid answers" };
  const answers = {};
  for (const q of survey.questions || []) {
    const v = raw[q.id];
    const empty =
      v === undefined || v === null || v === "" ||
      (Array.isArray(v) && v.length === 0);
    if (q.required && empty) return { error: `Missing required answer: ${q.label}` };

    if (q.type === "text" || q.type === "longtext") {
      if (empty) { answers[q.id] = ""; continue; }
      // Per-question limit (designer-set); hard ceiling 5000 regardless.
      const maxChars = Math.min(5000, Number(q.maxChars) || (q.type === "text" ? 140 : 5000));
      if (typeof v !== "string" || v.length > maxChars) return { error: "Text answer too long" };
      answers[q.id] = v;
    } else if (q.type === "single" || q.type === "rating") {
      if (empty) { answers[q.id] = null; continue; }
      const allowed = q.type === "rating" ? ["1", "2", "3", "4", "5"] : q.options || [];
      if (!allowed.includes(v)) return { error: "Invalid choice" };
      answers[q.id] = v;
    } else if (q.type === "multi") {
      if (empty) { answers[q.id] = []; continue; }
      if (!Array.isArray(v) || v.some((x) => !(q.options || []).includes(x))) {
        return { error: "Invalid choices" };
      }
      answers[q.id] = [...new Set(v)];
    } else if (q.type === "meeting") {
      // "maybe" accepted only for legacy definitions that still list it.
      const cols = q.choices || ["yes", "no"];
      const grid = {};
      for (const slot of q.slots || []) {
        const sv = v && typeof v === "object" ? v[slot] : null;
        if (sv !== null && sv !== undefined && !cols.includes(sv)) return { error: "Invalid grid answer" };
        if (q.required && (sv === null || sv === undefined)) {
          return { error: `Missing required answer: ${q.label}` };
        }
        grid[slot] = sv ?? null;
        // Painted-grid respondents may send exact partial availability under
        // "<slot> (parts)": ISO instants that must lie within the slot's
        // own 30-minute cells (validated against slotCells/slotTimes).
        const parts = v && typeof v === "object" ? v[`${slot} (parts)`] : undefined;
        if (parts !== undefined && parts !== null) {
          if (!Array.isArray(parts) || parts.length > 96) return { error: "Invalid parts" };
          const cells = q.slotCells && q.slotCells[slot];
          const allowed = new Set(Array.isArray(cells) ? cells : []);
          for (const p of parts) {
            if (typeof p !== "string") return { error: "Invalid parts" };
            const ts = Date.parse(p);
            if (isNaN(ts)) return { error: "Invalid parts" };
            // With slotCells require an exact cell match; otherwise (legacy
            // surveys) accept instants inside the slot's time range.
            if (allowed.size) {
              if (!allowed.has(new Date(ts).toISOString())) return { error: "Part outside slot" };
            } else {
              const t = q.slotTimes && q.slotTimes[slot];
              if (!t || ts < Date.parse(t.start) || ts >= Date.parse(t.end)) {
                return { error: "Part outside slot" };
              }
            }
          }
          grid[`${slot} (parts)`] = parts.map((p) => new Date(Date.parse(p)).toISOString());
        }
      }
      answers[q.id] = grid;
    }
  }
  return { answers };
}

function ghHeaders(env) {
  return {
    Authorization: `Bearer ${env.GH_TOKEN}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "survey-worker",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function contentsUrl(env, path) {
  return `${GH_API}/repos/${env.GH_OWNER}/${env.PRIVATE_REPO}/contents/${path}`;
}

// Cache aggregate counts briefly so a burst of respondents doesn't hammer
// the GitHub API (each call reads every response file for the survey).
const popularityCache = new Map(); // surveyId -> {data, fetchedAt}
const POPULARITY_TTL_MS = 60 * 1000;
const countCache = new Map(); // surveyId -> {total, fetchedAt}

// Look up the caller's own response by browser token (salted-hash filename).
async function handleResponse(request, url, env, cors) {
  const surveyId = String(url.searchParams.get("surveyId") || "");
  if (!/^[a-zA-Z0-9_-]{4,40}$/.test(surveyId)) return json({ error: "Invalid survey id" }, 400, cors);
  const token = request.headers.get("X-Survey-Token") || "";
  if (!token || token.length > 64) return json({ error: "No token" }, 400, cors);
  const key = (await sha256Hex(`${env.IP_SALT}:tok:${surveyId}:${token}`)).slice(0, 24);
  const item = await fetch(contentsUrl(env, `responses/${surveyId}/${key}.json`), {
    headers: ghHeaders(env),
  });
  if (item.status === 404) return json({ error: "Not found" }, 404, cors);
  if (!item.ok) throw new Error(`lookup ${item.status}`);
  const meta = await item.json();
  const rec = JSON.parse(base64ToUtf8(meta.content || ""));
  // Return only what the respondent may see: their own answers.
  return json({
    name: rec.name ?? null,
    answers: rec.answers || {},
    submittedAt: rec.submittedAt,
    editedAt: rec.editedAt || null,
  }, 200, cors);
}

// Bare response count from ONE directory listing (no per-file reads).
async function handleCount(url, env, cors) {
  const surveyId = String(url.searchParams.get("surveyId") || "");
  if (!/^[a-zA-Z0-9_-]{4,40}$/.test(surveyId)) return json({ error: "Invalid survey id" }, 400, cors);
  const cached = countCache.get(surveyId);
  if (cached && Date.now() - cached.fetchedAt < POPULARITY_TTL_MS) {
    return json({ total: cached.total }, 200, cors);
  }
  // A fresh popularity result already knows the total.
  const pop = popularityCache.get(surveyId);
  if (pop && Date.now() - pop.fetchedAt < POPULARITY_TTL_MS) {
    return json({ total: pop.data.total }, 200, cors);
  }
  const listing = await fetch(contentsUrl(env, `responses/${surveyId}`), { headers: ghHeaders(env) });
  let total = 0;
  if (listing.ok) {
    total = (await listing.json()).filter((f) => f.type === "file" && !f.name.startsWith("ip-")).length;
  } else if (listing.status !== 404) {
    throw new Error(`listing ${listing.status}`);
  }
  countCache.set(surveyId, { total, fetchedAt: Date.now() });
  return json({ total }, 200, cors);
}

async function handlePopularity(url, env, cors) {
  const surveyId = String(url.searchParams.get("surveyId") || "");
  if (!/^[a-zA-Z0-9_-]{4,40}$/.test(surveyId)) return json({ error: "Invalid survey id" }, 400, cors);

  const cached = popularityCache.get(surveyId);
  if (cached && Date.now() - cached.fetchedAt < POPULARITY_TTL_MS) {
    return json(cached.data, 200, cors);
  }

  const survey = await getDefinition(env, surveyId);
  if (!survey) return json({ error: "Survey not found" }, 404, cors);

  // Collect the meeting questions' cell universes (ISO instant -> count).
  const meetingQs = (survey.questions || []).filter((q) => q.type === "meeting");
  const counts = {}; // qid -> {iso: n}
  const universe = {}; // qid -> Set of valid ISO cells
  for (const q of meetingQs) {
    counts[q.id] = {};
    universe[q.id] = new Set();
    for (const slot of q.slots || []) {
      const cells = q.slotCells && q.slotCells[slot];
      if (Array.isArray(cells)) {
        for (const c of cells) universe[q.id].add(new Date(Date.parse(c)).toISOString());
      } else if (q.slotTimes && q.slotTimes[slot]) {
        const s = Date.parse(q.slotTimes[slot].start), e = Date.parse(q.slotTimes[slot].end);
        if (!isNaN(s) && !isNaN(e)) {
          for (let ts = s; ts < e; ts += 30 * 60000) universe[q.id].add(new Date(ts).toISOString());
        }
      }
    }
  }

  const dir = `responses/${surveyId}`;
  const listing = await fetch(contentsUrl(env, dir), { headers: ghHeaders(env) });
  let total = 0;
  if (listing.ok) {
    const files = (await listing.json()).filter((f) => f.type === "file" && !f.name.startsWith("ip-"));
    // Read files in parallel batches (serial reads cost ~0.1s each).
    const records = [];
    const BATCH = 8;
    for (let i = 0; i < files.length; i += BATCH) {
      const metas = await Promise.all(files.slice(i, i + BATCH).map((f) => {
        const filePath = f.path || `${dir}/${f.name}`;
        return fetch(contentsUrl(env, filePath), { headers: ghHeaders(env) })
          .then((r) => (r.ok ? r.json() : null)).catch(() => null);
      }));
      for (const meta of metas) {
        if (!meta) continue;
        try { records.push(JSON.parse(base64ToUtf8(meta.content || ""))); } catch { /* skip */ }
      }
    }
    for (const rec of records) {
      total++;
      for (const q of meetingQs) {
        const a = (rec.answers || {})[q.id] || {};
        for (const slot of q.slots || []) {
          const parts = a[`${slot} (parts)`];
          let instants = null;
          if (Array.isArray(parts) && parts.length) instants = parts;
          else if (a[slot] === "yes" || a[slot] === "maybe") {
            instants = [...universe[q.id]].filter((iso) => {
              // full-block answer: count only this slot's cells
              const cells = q.slotCells && q.slotCells[slot];
              if (Array.isArray(cells)) return cells.some((c) => new Date(Date.parse(c)).toISOString() === iso);
              const t = q.slotTimes && q.slotTimes[slot];
              if (!t) return false;
              const ts = Date.parse(iso);
              return ts >= Date.parse(t.start) && ts < Date.parse(t.end);
            });
          }
          if (!instants) continue;
          for (const p of instants) {
            const iso = new Date(Date.parse(p)).toISOString();
            if (!universe[q.id].has(iso)) continue;
            counts[q.id][iso] = (counts[q.id][iso] || 0) + 1;
          }
        }
      }
    }
  } else if (listing.status !== 404) {
    throw new Error(`listing ${listing.status}`);
  }

  const data = { total, counts };
  popularityCache.set(surveyId, { data, fetchedAt: Date.now() });
  return json(data, 200, cors);
}

async function handleSubmit(request, env, cors) {
  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY_BYTES) return json({ error: "Submission too large" }, 413, cors);

  let body;
  try { body = JSON.parse(bodyText); } catch { return json({ error: "Invalid JSON" }, 400, cors); }

  const surveyId = String(body.surveyId || "");
  if (!/^[a-zA-Z0-9_-]{4,40}$/.test(surveyId)) return json({ error: "Invalid survey id" }, 400, cors);

  const survey = await getDefinition(env, surveyId);
  if (!survey) return json({ error: "Survey not found" }, 404, cors);
  if (survey.open === false) return json({ error: "Survey closed" }, 410, cors);

  const { answers, error } = validateAnswers(survey, body.answers);
  if (error) return json({ error }, 400, cors);

  let name = null;
  if (survey.collectName) {
    name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
    if (!name) return json({ error: "Name is required" }, 400, cors);
  }

  // --- duplicate detection ---
  const mode = survey.dedup || "browser+ip";
  const dir = `responses/${surveyId}`;
  const isEdit = body.edit === true;
  let keys = [];
  let existingSha = null;
  let existingRecord = null;
  if (mode !== "off") {
    const token = typeof body.token === "string" ? body.token.slice(0, 64) : "";
    if (token) {
      keys.push({ filename: `${(await sha256Hex(`${env.IP_SALT}:tok:${surveyId}:${token}`)).slice(0, 24)}.json` });
    }
    if (mode === "browser+ip" && !isEdit) {
      const ip = request.headers.get("CF-Connecting-IP") || "";
      if (ip) {
        keys.push({ filename: `ip-${(await sha256Hex(`${env.IP_SALT}:ip:${surveyId}:${ip}`)).slice(0, 24)}.json` });
      }
    }
    if (keys.length === 0) return json({ error: "Missing dedup token" }, 400, cors);

    if (isEdit) {
      // Edit: the caller must already own a response under their token key.
      if (!token) return json({ error: "Edit requires browser token" }, 400, cors);
      const check = await fetch(contentsUrl(env, `${dir}/${keys[0].filename}`), {
        headers: ghHeaders(env),
      });
      if (check.status === 404) return json({ error: "No response to edit" }, 404, cors);
      if (!check.ok) throw new Error(`edit lookup ${check.status}`);
      const meta = await check.json();
      existingSha = meta.sha;
      try { existingRecord = JSON.parse(base64ToUtf8(meta.content || "")); } catch { /* keep null */ }
      keys = [keys[0]]; // never touch ip markers on edit
    } else {
      for (const key of keys) {
        const check = await fetch(contentsUrl(env, `${dir}/${key.filename}`), {
          headers: ghHeaders(env),
        });
        if (check.status === 200) return json({ error: "Already submitted" }, 409, cors);
        if (check.status !== 404) throw new Error(`dedup check ${check.status}`);
      }
    }
  } else {
    if (isEdit) return json({ error: "Editing not available for this survey" }, 400, cors);
    keys = [{ filename: `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.json` }];
  }

  // --- response cap (soft limit; edits don't add a response) ---
  if (!isEdit) {
    const cap = Number(survey.maxResponses) || 200;
    const listing = await fetch(contentsUrl(env, dir), { headers: ghHeaders(env) });
    if (listing.ok) {
      const files = await listing.json();
      const count = Array.isArray(files)
        ? files.filter((f) => !f.name.startsWith("ip-")).length
        : 0;
      if (count >= cap) return json({ error: "Survey full" }, 429, cors);
    } else if (listing.status !== 404) {
      throw new Error(`cap check ${listing.status}`);
    }
  }

  // --- write response ---
  const responseId = keys[0].filename.replace(/\.json$/, "");
  const record = {
    surveyId,
    responseId,
    submittedAt: isEdit && existingRecord ? existingRecord.submittedAt : new Date().toISOString(),
    name, // null for anonymous surveys
    answers,
    // Salted hashes only — no raw IP or browser token is ever stored.
    dedup: mode === "off" ? null : { mode, key: responseId },
  };
  if (isEdit) record.editedAt = new Date().toISOString();
  const encoded = utf8ToBase64(JSON.stringify(record, null, 2));

  async function putFile(filename, content, message, sha) {
    const payload = { message, content, branch: "main" };
    if (sha) payload.sha = sha; // update existing file
    return fetch(contentsUrl(env, `${dir}/${filename}`), {
      method: "PUT",
      headers: { ...ghHeaders(env), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  // Canonical record under the first key (browser token, or IP if no token).
  const put = await putFile(keys[0].filename, encoded,
    isEdit ? `Edit response for ${surveyId}` : `Response for ${surveyId}`,
    isEdit ? existingSha : undefined);
  if (!isEdit && (put.status === 409 || put.status === 422)) {
    // A concurrent identical submission won the race.
    return json({ error: "Already submitted" }, 409, cors);
  }
  if (!put.ok) throw new Error(`write ${put.status}`);

  // Secondary IP marker so a new browser on the same IP is also blocked.
  // Prefixed "ip-" so the R reader and the cap check can skip it.
  if (!isEdit && keys.length > 1) {
    const marker = await putFile(
      keys[1].filename,
      utf8ToBase64(JSON.stringify({ marker: true, responseId })),
      `IP marker for ${surveyId}`
    );
    if (!marker.ok && marker.status !== 409 && marker.status !== 422) {
      throw new Error(`marker write ${marker.status}`);
    }
  }

  popularityCache.delete(surveyId);
  countCache.delete(surveyId);
  return json({ ok: true }, 200, cors);
}
