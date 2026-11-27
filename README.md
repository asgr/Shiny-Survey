# Private surveys on GitHub Pages + Cloudflare Workers (all free)

Design a survey in your browser, share a link, and collect responses into a
**private GitHub repo only you can read**. No server to run, no paid services.

```
Designer (your browser) ──publish──▶ Public repo (GitHub Pages)
Respondent ──loads survey──────────▶ Public repo
Respondent ──submits answers───────▶ Cloudflare Worker ──writes──▶ Private repo
Respondent ──popularity shading────▶ Worker /popularity (aggregate counts only)
You ──results page / R script──────▶ Private repo (your token, browser-side)
```

- **Public repo** (this one): the survey designer, the survey page, and survey
  *definitions* (questions only — never responses, never secrets).
- **Private repo**: one JSON file per response. Only you have access.
- **Cloudflare Worker** (free tier, 100k requests/day): validates submissions,
  blocks duplicates, enforces a response cap, and writes to the private repo
  using a token stored as a server-side secret. Respondents never see a token.

## Setting up with an AI assistant (recommended)

First, clone this repo to your local machine (the assistant needs the
files locally to configure and push them to your own repos):

```sh
git clone https://github.com/asgr/Shiny-Survey.git
cd Shiny-Survey
```

Open the cloned folder in an AI coding assistant (Claude Code, Posit
Assistant, Cursor, Copilot, …) and paste this prompt:

> Read AGENTS.md in this repository fully and deploy this survey system
> for me as a NEW user. Do not reuse any names, URLs, or values from the
> repo's history or examples — they belong to the original author.
> Start by asking me the personalization questions listed in AGENTS.md
> (GitHub username, repo names, Cloudflare account, Worker name, timezone).
> Then follow the staged runbook: do the [AI] steps yourself, and for each
> [HUMAN] step give me exact click-by-click instructions and wait for me to
> confirm before continuing. Never ask me to paste tokens into the chat —
> I will enter them only into the GitHub/Cloudflare dashboards and the
> designer page. Verify each stage (as described in AGENTS.md) before
> moving to the next, run the end-to-end tests with a temporary survey,
> and clean up the test data afterwards. Explain any propagation delays
> rather than treating them as bugs.

The assistant will need permission to run shell commands (git, curl,
python3) and edit files in the repo. You will need a GitHub account and a
free Cloudflare account; everything else is guided.

## Manual one-time setup (~15 minutes)

Start by cloning this repo locally (`git clone
https://github.com/asgr/Shiny-Survey.git`) — you'll edit the config and
push to your own repos from there.

### 1. Repos

1. Push this project to a **public** GitHub repo (Pages is free only for public
   repos). Keep the name `Shiny-Survey` or update the config below.
2. Create a second, **private** repo, e.g. `survey-responses`, with a README
   (so the `main` branch exists).

### 2. Tokens (fine-grained PATs)

At https://github.com/settings/personal-access-tokens/new create two tokens:

| Token | Repository access | Permission | Used by |
|---|---|---|---|
| Designer token | public repo (read & write) + private repo (**read-only**) | Contents | designer, private results viewer (stays in your browser's localStorage) |
| Worker token | private repo only | Contents: **read & write** | Cloudflare Worker secret |

The private-repo read on the designer token is what lets the **Results**
page fetch responses. Without it, survey creation still works but results
show an access error.

Optionally a third read-only token on the private repo for the R script;
the Worker token also works. Put it in `~/.Renviron` as `GITHUB_PAT=...`.

### 3. Enable GitHub Pages

Repo **Settings → Pages → Build and deployment**: Source = *Deploy from a
branch*, Branch = `main`, folder = `/docs`. Your site will be at
`https://YOUR_USERNAME.github.io/Shiny-Survey/`.

### 4. Deploy the Worker

1. Create a free account at https://dash.cloudflare.com (no credit card).
2. **Workers & Pages → Create → Worker**. Name it e.g. `my-survey-receiver`,
   Deploy the hello-world, then **Edit code** and replace everything with the
   contents of [worker/survey-worker.js](worker/survey-worker.js). Deploy.
3. In the Worker's **Settings → Variables and Secrets**, add:

   | Name | Type | Value |
   |---|---|---|
   | `GH_TOKEN` | Secret | Worker token from step 2 |
   | `IP_SALT` | Secret | long random string (`openssl rand -hex 32`) |
   | `GH_OWNER` | Text | your GitHub username |
   | `PRIVATE_REPO` | Text | `survey-responses` |
   | `PUBLIC_REPO` | Text | `Shiny-Survey` |
   | `ALLOWED_ORIGIN` | Text | `https://YOUR_USERNAME.github.io` |

4. Check it: open `https://my-survey-receiver.YOUR-SUBDOMAIN.workers.dev/health`
   — you should see `{"ok":true,...}`.

### 5. Configure the site

Edit [docs/assets/config.js](docs/assets/config.js): set `owner`, `publicRepo`,
`privateRepo`, and `workerUrl`. Run `python3 scripts/bump_manifest.py`, then
commit and push.

## Creating a survey

1. Open `https://YOUR_USERNAME.github.io/Shiny-Survey/` (the designer).
2. Paste your **designer token** once — it is stored only in your browser.
3. Set title, anonymity (name field on/off), duplicate prevention, and cap.
4. Add questions: short/long text (per-question character limits, defaults
   140 / 5000), Yes/No (optional third option like N/A), single choice
   (radios or **dropdown** for long lists), multiple choice, 1–5 rating,
   **number** (optional min/max; results show mean/median/histogram),
   **Likert scale** (statements × agreement columns, customizable 2–7
   points; results show stacked distributions and mean scores), or a
   **meeting grid** —
   a when2meet-style grid in 30-minute windows spanning up to 28 days
   (wide grids scroll horizontally). Drag a rectangle to pick candidate
   times (adjacent cells merge into one time range); click a selected cell
   to deselect it. Set the **timezone** the times are expressed in
   (defaults to your local zone). Choose how respondents see the question:
   the heatmap **grid**, or a **simple list** (available / not per window —
   better for few windows spread over many days). The live preview shows
   exactly what respondents will see, full width.
5. **Publish survey** and share the generated link
   (`survey.html?id=...`). New surveys work within seconds; *edits* to an
   existing survey can take up to ~5 minutes to reach respondents (GitHub
   caches definition files server-side). Edits are not live until you
   click Publish.
6. Later: **Edit** to change questions, **Open / close** to stop responses
   (toggles also take up to ~5 minutes to propagate), **Delete** to remove
   a survey (definition only — collected responses stay in the private
   repo; delete them there separately if wanted). The survey list shows
   each survey's open/closed state and response count.
   Note: changing questions after responses exist can make old answers harder
   to interpret — prefer closing and creating a new survey instead.

### What respondents see (meeting grids)

- Candidate times appear as highlighted cells on a week grid, in the
  respondent's own timezone (selectable: local, UTC/GMT, fixed offsets
  -12..+14, then named zones; the organizer's zone is noted).
- **Click a cell** to toggle that single 30-minute window; **drag a box**
  to paint several cells at once (dragging from a selected cell erases).
  Availability is binary: any painted time in a window counts as available.
- With the **list** display option, respondents instead see each time
  window as a row with available / not-available choices.
- **Revisiting the link** after responding shows their own answers
  read-only, with an "Edit my response" button (same browser required —
  the response is keyed to a browser token; clearing browser storage or
  switching devices loses the association). Edits update the same
  response, keep the original submission time, and record an edit time.
- Once others have responded, cells are **shaded by popularity** (stronger
  blue = more people available), with the total respondent count and
  min/max availability shown above the grid and exact counts on hover.
  A respondent's green selection keeps the same shading, making overlap
  with popular windows visible. Only aggregate counts are exposed — never
  names or individual answers.

## Viewing results

### In the browser (private)

Click **Results** next to a survey in the designer. You get:

- bar charts + counts tables for choice/rating questions (mean for
  ratings), with respondent names on hover
- number questions: n / mean / median / range + histogram
- Likert questions: stacked distribution per statement (diverging
  colours, names on hover) + mean score table
- meeting questions: availability bars, counts table, and a
  when2meet-style **heatmap** (greener = more overlap, names on hover,
  timezone-selectable)
- responses-over-time chart, respondent list

Results are fetched from the private repo with your token, browser-side —
nothing is ever published. **Share a snapshot** downloads a standalone
HTML file (charts and tables baked in, no scripts or credentials) with an
optional anonymize-names checkbox for public sharing.

### In R

```r
source("R/fetch_responses.R")   # needs gh + jsonlite; GITHUB_PAT in ~/.Renviron
df <- fetch_responses("k3f9x2ab")     # one row per respondent
meeting_tally(df, "q_ab12cd34")       # available / not available per window
cell_tally(df, "q_ab12cd34", "k3f9x2ab", tz = "Australia/Perth")
                                      # 30-min resolution availability counts
save_responses_csv("k3f9x2ab")        # export CSV
```

Update `SURVEY_OWNER` / repo names at the top of the script once.
Question column names are the question ids from the survey definition
(`fetch_definition("k3f9x2ab")` shows ids, labels, and slots). Partial
availability is stored both as the window's binary status and as exact
30-minute instants under `"<slot> (parts)"` columns.

## Privacy & duplicate prevention

- Anonymous surveys store **no names, no raw IPs, no raw browser tokens** —
  only salted SHA-256 hashes used for dedup. With `IP_SALT` kept secret, the
  hashes are not reversible in practice.
- Dedup modes per survey:
  - `browser+ip` (default): blocks the same browser *or* the same IP.
  - `browser`: blocks the same browser only (kinder to shared networks).
  - `off`: unlimited repeats.
- **Known limits**: people behind one office/WiFi NAT share an IP, so in
  `browser+ip` mode the second person from that network may be blocked
  (switch that survey to `browser` mode). Conversely, incognito + a different
  network can evade dedup. This is a deterrent, not a guarantee — appropriate
  for meeting polls, not elections.
- The response cap (default 200) is enforced by the Worker; it's a soft limit
  under simultaneous submissions.
- The Worker rejects submissions from other origins, validates every answer
  against the survey definition, drops unknown fields, and caps body size.
- The popularity endpoint (`GET /popularity`) returns **only aggregate
  counts per 30-minute cell** plus the respondent total — no names,
  answers, or dedup keys — and is origin-checked like submissions.

## Sharing survey creation with a team

The designer page is public; authorization comes from GitHub. To let a
colleague create surveys:

1. Add them as a **collaborator** on the public repo (and on the private
   repo too if they should see results — that grants access to *all*
   responses).
2. They create their **own** fine-grained PAT (Contents: read & write on
   the public repo; add read-only on the private repo for results).
3. They open the designer URL and paste their token — it stays in their
   browser. Never share your own token.

Anyone with write access can edit/close any survey in the shared list;
this is a shared workspace, not isolated accounts.

## Free-tier budget

GitHub Pages + private repos: free. Cloudflare Workers: 100,000 requests/day
free — each submission uses ~5 requests, so tens of thousands of responses per
day. No GitHub Actions minutes are used.

## Deploying frontend changes

Assets are cache-busted via `docs/assets/manifest.json` (loaded by
`boot.js`). After editing anything under `docs/assets/`, run:

```sh
python3 scripts/bump_manifest.py
```

then commit and push. Without this, browsers may serve stale scripts for
up to 10 minutes (GitHub Pages `max-age=600`).

The Worker is deployed separately: paste `worker/survey-worker.js` into the
Cloudflare dashboard whenever it changes.

Run the headless test suites (macOS, no Node needed) before pushing JS
changes: `sh tests/run.sh`.

## Project layout

```
docs/            GitHub Pages site
  index.html     survey designer (your token, your browser only)
  survey.html    respondent page (?id=<survey-id>)
  results.html   private results viewer (?id=<survey-id>)
  assets/        vanilla JS + CSS (no build step); boot.js + manifest.json
                 handle cache-busting
  surveys/       published survey definitions (public, questions only)
worker/          Cloudflare Worker source (paste into dashboard)
R/               fetch_responses.R — results -> data frame / CSV
scripts/         bump_manifest.py — regenerate asset versions before push
examples/        reference screenshots (not published)
```
