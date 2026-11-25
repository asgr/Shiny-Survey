# Private surveys on GitHub Pages + Cloudflare Workers (all free)

Design a survey in your browser, share a link, and collect responses into a
**private GitHub repo only you can read**. No server to run, no paid services.

```
Designer (your browser) ──publish──▶ Public repo (GitHub Pages)
Respondent ──loads survey──────────▶ Public repo
Respondent ──submits answers───────▶ Cloudflare Worker ──writes──▶ Private repo
You ──R script (gh)────────────────────────────────────────────▶ Private repo
```

- **Public repo** (this one): the survey designer, the survey page, and survey
  *definitions* (questions only — never responses, never secrets).
- **Private repo**: one JSON file per response. Only you have access.
- **Cloudflare Worker** (free tier, 100k requests/day): validates submissions,
  blocks duplicates, enforces a response cap, and writes to the private repo
  using a token stored as a server-side secret. Respondents never see a token.

## One-time setup (~15 minutes)

### 1. Repos

1. Push this project to a **public** GitHub repo (Pages is free only for public
   repos). Keep the name `Shiny-Survey` or update the config below.
2. Create a second, **private** repo, e.g. `survey-responses`, with a README
   (so the `main` branch exists).

### 2. Tokens (fine-grained PATs)

At https://github.com/settings/personal-access-tokens/new create two tokens:

| Token | Repository access | Permission | Used by |
|---|---|---|---|
| Designer token | public repo only | Contents: **read & write** | designer page (stays in your browser's localStorage) |
| Worker token | private repo only | Contents: **read & write** | Cloudflare Worker secret |

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
and `workerUrl`. Commit and push.

## Creating a survey

1. Open `https://YOUR_USERNAME.github.io/Shiny-Survey/` (the designer).
2. Paste your **designer token** once — it is stored only in your browser.
3. Set title, anonymity (name field on/off), duplicate prevention, and cap.
4. Add questions: short/long text, single/multiple choice, 1–5 rating, or a
   **meeting grid** (one candidate date/time per line; respondents answer
   yes / no / maybe for each).
5. **Publish survey** and share the generated link
   (`survey.html?id=...`). It works within seconds.
6. Later: **Edit** to change questions, **Open / close** to stop responses.
   Note: changing questions after responses exist can make old answers harder
   to interpret — prefer closing and creating a new survey instead.

## Reading results (R)

```r
source("R/fetch_responses.R")   # needs gh + jsonlite; GITHUB_PAT in ~/.Renviron
df <- fetch_responses("k3f9x2ab")     # one row per respondent
meeting_tally(df, "q_ab12cd34")       # yes/maybe/no counts per date/time
save_responses_csv("k3f9x2ab")        # export CSV
```

Update `SURVEY_OWNER` / repo names at the top of the script once.
Question column names are the question ids from the survey definition
(`fetch_definition("k3f9x2ab")` shows ids, labels, and slots).

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

## Free-tier budget

GitHub Pages + private repos: free. Cloudflare Workers: 100,000 requests/day
free — each submission uses ~5 requests, so tens of thousands of responses per
day. No GitHub Actions minutes are used.

## Project layout

```
docs/            GitHub Pages site
  index.html     survey designer (your token, your browser only)
  survey.html    respondent page (?id=<survey-id>)
  assets/        vanilla JS + CSS (no build step)
  surveys/       published survey definitions (public, questions only)
worker/          Cloudflare Worker source (paste into dashboard)
R/               fetch_responses.R — results -> data frame / CSV
```