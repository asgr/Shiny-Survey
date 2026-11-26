# AGENTS.md — deployment & maintenance runbook for AI assistants

This file lets an AI coding assistant set up, deploy, and maintain this
project for a **new user**. Read it fully before acting.

## What this project is

A free, private survey system with no server to run:

- **Public GitHub repo** (this repo): a static site on GitHub Pages (`docs/`)
  containing the survey designer, respondent page, private results viewer,
  and published survey *definitions* (questions only — never responses).
- **Private GitHub repo**: one JSON file per response. Only the owner reads it.
- **Cloudflare Worker** (free tier): the only server-side component. Holds a
  GitHub write-token as a secret; validates submissions, deduplicates,
  enforces caps, writes responses to the private repo, and serves
  aggregate-only popularity counts for grid shading.

```
Designer (owner's browser + their PAT) ──publish──▶ public repo
Respondent ──load survey──────────────────────────▶ public repo (raw.githubusercontent.com)
Respondent ──POST /submit─────────────────────────▶ Worker ──write──▶ private repo
Respondent ──GET /popularity──────────────────────▶ Worker (aggregate counts only)
Owner ──results.html / R script───────────────────▶ private repo (their PAT, browser-side)
```

Security invariants — never violate these:
- No token or secret may ever appear in `docs/` (it is all public).
- The designer/results pages use the *owner's* PAT from their browser
  localStorage only. Respondents never see any token.
- `/popularity` must return only `{total, counts}` — never names, answers,
  dedup keys, or raw IPs.
- Responses store salted SHA-256 hashes for dedup, never raw IPs/tokens.

## IMPORTANT: personalize first

**Do not reuse names from this repo's history or examples.** Values like
`asgr`, `Shiny-Survey`, `survey-responses`, `asgr-survey`,
`*.zbb9v8454s.workers.dev`, `waves-9b7` belong to the original deployment.
Before making changes, ask the user:

1. GitHub username (→ `GH_OWNER`, config `owner`).
2. Public repo name (default suggestion: `surveys`; → `PUBLIC_REPO`, config
   `publicRepo`). Must be **public** for free GitHub Pages.
3. Private repo name (default suggestion: `survey-responses`; →
   `PRIVATE_REPO`, config `privateRepo`).
4. Cloudflare: do they have an account? Which account should host the
   Worker? Desired Worker name (→ its URL).
5. Preferred default timezone for examples/docs (do not assume the
   original author's `Australia/Perth`).

Files that contain deployment-specific values (update all of them):
- `docs/assets/config.js` — `owner`, `publicRepo`, `privateRepo`, `workerUrl`
- `R/fetch_responses.R` — `SURVEY_OWNER`, `SURVEY_PRIVATE_REPO`, `SURVEY_PUBLIC_REPO`
- Worker environment variables (set in Cloudflare dashboard, NOT in code)
- `README.md` URLs if you change the repo name

## Fresh deployment runbook

Steps marked **[HUMAN]** require the user in a browser dashboard — give
exact click-by-click instructions and wait for confirmation. Steps marked
**[AI]** you can do yourself. Verify each stage before the next.

### Stage 1 — repos
1. **[HUMAN]** Create the public repo on GitHub (no README needed if
   pushing this project into it) and a **private** repo *with* a README
   (so `main` exists — the Worker writes into it).
2. **[AI]** Set git remote, commit, push to the public repo. If the user
   already has commits, `git pull --rebase` before pushing (the designer
   publishes surveys via the API, so the remote often moves ahead).

### Stage 2 — tokens (fine-grained PATs)
**[HUMAN]** at https://github.com/settings/personal-access-tokens/new —
two tokens, "Only select repositories":

| Token | Repos | Contents permission |
|---|---|---|
| designer token | public repo + private repo | Read & write (public), Read-only (private) |
| worker token | private repo only | Read & write |

- The private-repo read on the designer token powers the Results page.
- Tokens are shown once; the user must store them safely. **Never ask the
  user to paste a token into chat.** They enter tokens only into the
  designer page (designer token) and Cloudflare secrets (worker token).
- Optional third token (private repo, read-only) for R: user adds
  `GITHUB_PAT=...` to `~/.Renviron` themselves.

### Stage 3 — GitHub Pages
**[HUMAN]** Public repo → Settings → Pages → Source: *Deploy from a
branch*, Branch `main`, folder `/docs`.
**[AI]** Poll `https://<user>.github.io/<publicRepo>/` until HTTP 200
(first build takes 1–2 min).

### Stage 4 — Cloudflare Worker
1. **[HUMAN]** https://dash.cloudflare.com → correct account → Workers &
   Pages → Create → Worker. (First Worker on an account prompts for a
   `workers.dev` subdomain — any name.) Name it, Deploy the hello-world,
   then **Edit code**, replace everything with `worker/survey-worker.js`,
   Deploy.
2. **[HUMAN]** Worker → Settings → Variables and Secrets:

   | Name | Type | Value |
   |---|---|---|
   | `GH_TOKEN` | Secret | worker token from Stage 2 |
   | `IP_SALT` | Secret | random hex — **[AI]** generate via `openssl rand -hex 32` and give it to the user to paste |
   | `GH_OWNER` | Text | GitHub username |
   | `PRIVATE_REPO` | Text | private repo name |
   | `PUBLIC_REPO` | Text | public repo name |
   | `ALLOWED_ORIGIN` | Text | `https://<user>.github.io` (origin only, no path) |

3. **[HUMAN]** Report the Worker URL (`https://<name>.<subdomain>.workers.dev`).
4. **[AI]** Verify:
   - `GET <worker>/health` → `{"ok":true,...}`
   - `POST <worker>/submit` with header `Origin: https://evil.example` → 403
   - `POST <worker>/submit` with correct Origin and a nonexistent
     `surveyId` → 404 (proves it reads the public repo)

### Stage 5 — configure & verify end-to-end
1. **[AI]** Fill in `docs/assets/config.js` and `R/fetch_responses.R` with
   the user's values. Run `python3 scripts/bump_manifest.py`. Commit, push.
2. **[HUMAN]** Open the designer URL, paste the designer token, create a
   small test survey (a meeting grid is the richest test), Publish, and
   report the survey id from the share link.
3. **[AI]** End-to-end checks with `curl` (see "Verification" below).
4. **[HUMAN/AI]** Clean up test surveys afterwards: Delete button in the
   designer (definitions), and delete `responses/<id>/` in the private
   repo (responses) — via github.com or the API with the user's consent.

## Verification recipes (for the AI)

Let `W=<workerUrl>`, `O=https://<user>.github.io`, raw definitions at
`https://raw.githubusercontent.com/<user>/<publicRepo>/main/docs/surveys/<id>.json`.

- Definition published: GET the raw URL → 200 and expected JSON.
- Valid submission: POST `$W/submit` with headers
  `Content-Type: application/json`, `Origin: $O`, body
  `{"surveyId":"<id>","token":"test-1","name":"Test","answers":{...}}`
  matching the definition exactly (meeting answers: `{"<slot label>":"yes"|"no"}`,
  optional `"<slot label> (parts)":["<ISO instant>",...]` from the slot's cells).
  → 200. Repeat identical → 409 (dedup). Invalid choice/label → 400.
- Popularity: GET `$W/popularity?surveyId=<id>` with `Origin: $O` →
  `{"total":N,"counts":{...}}`; assert no names/answers appear in the body.
- R read-back: `fetch_responses("<id>")` returns the submitted rows
  (needs GITHUB_PAT with private-repo read).
- Frontend deployed: compare `shasum docs/assets/<file>` against
  `curl -s https://<user>.github.io/<publicRepo>/assets/<file> | shasum`.

Headless JS testing: this repo has no Node dependency; on macOS use
`/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc`
with `checkSyntax()` / `checkModuleSyntax()` and small DOM/fetch stubs to
exercise `docs/assets/*.js` and the Worker (strip `export default` →
`const worker = {`). Stub `Request.text()` by snapshotting the body at
creation; make directory listings include `path`; return file GETs as
`{content: <base64>}` exactly as stored (GitHub API semantics).

## Maintenance rules (for the AI)

1. **Any change under `docs/assets/` or the HTML pages**: run
   `python3 scripts/bump_manifest.py` before committing, or browsers serve
   stale scripts (Pages `max-age=600`). `boot.js` loads assets in parallel
   with `async=false` (ordered execution) using `?v=<hash>` from
   `manifest.json`.
2. **Any change to `worker/survey-worker.js`**: the deployed Worker is a
   *copy* in the Cloudflare dashboard. Tell the user explicitly:
   "re-paste worker/survey-worker.js into the dashboard and Deploy",
   then verify via curl. Never assume it auto-deploys.
3. **`git pull --rebase` before every push** — the designer commits survey
   definitions via the GitHub API, so the remote moves independently.
4. **Propagation delays are inherent, not bugs**: raw.githubusercontent.com
   caches definitions ~5 min server-side (affects edits, open/close);
   the Worker adds `?t=` cache-busters for its own reads. Pages HTML has
   `max-age=600`. Explain this before debugging "my change didn't appear".
5. **Data model invariants** (changing these breaks stored responses):
   - Meeting answers are keyed by the organizer's slot label strings
     (e.g. `Mon Dec 7, 10:00–11:30`, en-dash U+2013). Viewer-timezone
     conversion must never change the keys.
   - 30-minute cells everywhere (`TG_STEP`/`RG_STEP`); `slotCells` stores
     UTC ISO instants per cell; `slotTimes` is the legacy range fallback.
   - Availability is binary (`yes`/`no`); legacy `maybe` = available.
     Partial selections add `"<slot> (parts)"` instant lists.
   - Response files: `responses/<surveyId>/<hash>.json`; `ip-` prefixed
     files are dedup markers (skip when counting/reading).
   - `IP_SALT` must stay constant across Worker redeploys/migrations or
     dedup breaks.
6. **Deleting/recreating surveys**: Delete removes the definition only.
   Reusing an id re-attaches old responses and dedup keys — delete
   `responses/<id>/` first if a clean slate is wanted.
7. **Don't break privacy**: anything added to `docs/` is public. New
   Worker endpoints must be origin-checked and must not leak response
   content without the owner's token (browser-side) — aggregate counts
   are the only public-derived data allowed.

## Known limitations (set expectations, don't "fix" silently)

- IP-based dedup blocks a second person behind the same NAT (office WiFi);
  per-survey `browser` mode avoids that. Incognito+VPN can evade dedup.
- Response cap is soft under concurrent submissions.
- GitHub API rate limits: ~5000 req/h per token; results page batches
  file reads 8-at-a-time; Worker caches popularity 60 s.
- Free tiers: Pages (public repos), private repos, Workers 100k req/day.
  No GitHub Actions used.
- Old browsers without `Intl.supportedValuesOf` fall back to UTC-only
  timezone lists; `Etc/GMT±n` zones have inverted IANA signs — labels in
  `tz.js` are computed from real offsets, keep it that way.

## File map

| Path | Purpose |
|---|---|
| `docs/index.html` + `assets/designer.js` | survey designer (owner's PAT) |
| `docs/survey.html` + `assets/survey.js`, `render.js`, `respond-grid.js`, `timegrid.js`, `tz.js` | respondent page, grids, timezones |
| `docs/results.html` + `assets/results.js`, `charts.js` | private results viewer, SVG charts, snapshot export |
| `docs/assets/boot.js`, `manifest.json` | cache-busting parallel loader |
| `docs/assets/config.js` | deployment-specific values (edit per user) |
| `docs/surveys/*.json` | published definitions (public) |
| `worker/survey-worker.js` | Cloudflare Worker: /submit, /popularity, /health |
| `R/fetch_responses.R` | fetch_responses / meeting_tally / cell_tally / CSV |
| `scripts/bump_manifest.py` | regenerate asset hashes before push |
| `examples/` | reference screenshots (not published) |