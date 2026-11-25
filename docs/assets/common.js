// Shared helpers for the designer and survey pages. No dependencies.
"use strict";

const CFG = window.SURVEY_CONFIG;
const BRANCH = "main";

function rawUrl(path) {
  return `https://raw.githubusercontent.com/${CFG.owner}/${CFG.publicRepo}/${BRANCH}/docs/${path}`;
}

// raw.githubusercontent.com caches for up to 5 minutes regardless of request
// cache mode. When the viewer has a token (designer/creator), read via the
// contents API instead — always current. Respondents use raw + cache-buster.
async function fetchSurveyDefinition(id, token) {
  if (token) {
    const f = await getSurveyFile(id, token);
    return f ? f.survey : null;
  }
  const res = await fetch(`${rawUrl(`surveys/${id}.json`)}?t=${Date.now()}`, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function apiUrl(path) {
  return `https://api.github.com/repos/${CFG.owner}/${CFG.publicRepo}/contents/docs/${path}`;
}

function surveyLink(id) {
  const base = location.href.replace(/[^/]*(\?.*)?(#.*)?$/, "");
  return `${base}survey.html?id=${encodeURIComponent(id)}`;
}

// --- base64 helpers that handle UTF-8 (btoa alone throws on non-Latin1) ---
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// --- GitHub contents API (used only by the designer, with YOUR token) ---
// missingOk: treat 404 as null (used for optional lookups like a directory
// that doesn't exist yet); otherwise 404 is an error worth showing.
async function ghRequest(path, { method = "GET", token, body, missingOk = false } = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 404 && missingOk) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status}: ${(data && data.message) || res.statusText}`);
  }
  return data;
}

// Fetch a survey definition with its file sha (needed to update it later).
async function getSurveyFile(id, token) {
  const data = await ghRequest(`surveys/${id}.json`, { token, missingOk: true });
  if (!data) return null;
  return { sha: data.sha, survey: JSON.parse(b64decode(data.content)) };
}

async function putSurveyFile(id, survey, token, sha, message) {
  const body = {
    message: message || `Update survey ${id}`,
    content: b64encode(JSON.stringify(survey, null, 2)),
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  return ghRequest(`surveys/${id}.json`, { method: "PUT", token, body });
}

async function listSurveys(token) {
  const data = await ghRequest("surveys", { token, missingOk: true });
  if (!Array.isArray(data)) return [];
  return data
    .filter((f) => f.name.endsWith(".json"))
    .map((f) => f.name.replace(/\.json$/, ""));
}

// Random id like "k3f9x2ab" — unguessable enough for a share link.
function newSurveyId() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Small DOM helper: el("div", {class: "x"}, child, "text", ...)
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    node.append(c.nodeType ? c : document.createTextNode(c));
  }
  return node;
}