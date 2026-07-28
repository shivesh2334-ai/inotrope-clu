# Deployment fix — wiring in the research hub and analysis hub

## What was actually wrong

Nothing in `server.js` or `vercel.json` was broken. The deployment showed
*only* the HTML tool because that's the only thing that was ever wired up:

- `vercel.json` builds `server.js` with `@vercel/node`, and `server.js` had
  exactly two routes — static file serving from `public/` and a catch-all
  that serves `index.html`. There was no `/api` directory, no other page
  routes, and no Python runtime configured anywhere.
- The Python analysis engine (`analytics/cs_stats_engine.py`) and the
  Google Apps Script hub (`google-apps-script/sheet-provisioner.gs`) were
  delivered as **standalone tools**, not integrated into this web app. The
  Apps Script piece in particular can never live "inside" the Vercel
  deployment regardless of configuration — it's a separate Google
  Workspace deployment target by design (script.google.com), not a file
  Vercel can build.

So this wasn't a deploy bug to fix — it was two features that were never
connected to the deployed surface. Now they are.

## What's new

- **`lib/stats.js`** — a pure-JS statistics engine (no scipy/statsmodels/
  lifelines) so it runs inside a plain Node function, which is what Vercel's
  default runtime supports without extra configuration. Every function
  (Welch's t-test, chi-square, one-way ANOVA, Kaplan-Meier, log-rank) is
  cross-validated against scipy/lifelines in the accompanying test output —
  matches to ~8-9 decimal places.
- **`POST /api/analyze`** — runs the above on JSON rows posted from the
  browser.
- **`public/analysis.html`** (served at `/analysis`) — CSV upload, configure
  group/continuous/categorical/time-event columns, results rendered as
  tables plus a hand-drawn SVG Kaplan-Meier curve (no chart library needed).
- **`POST /api/research/submit`** — a server-side proxy to your deployed
  Apps Script Web App. This exists because calling the Apps Script URL
  directly from browser JS hits a CORS wall: Google's Web App responds via
  a redirect to `script.googleusercontent.com` that carries no CORS
  headers, so `fetch()` from the page fails. Proxying server-to-server
  avoids the browser entirely.
- **`public/research.html`** (served at `/research`) — setup instructions
  for deploying the Apps Script separately, plus a form that submits a row
  through the proxy above.
- Nav links added across all three pages so they're discoverable from each
  other.

## What's honestly still not covered by the deployed (JS) analysis engine

- **Shapiro-Wilk normality testing** — no compact pure-JS implementation
  exists, so the deployed engine can't auto-select parametric vs.
  non-parametric tests the way `cs_stats_engine.py` does. It always uses
  the parametric test (Welch's t-test / one-way ANOVA). On the demo
  dataset this gave the same conclusion as Python for 3 of 4 continuous
  variables, but diverged slightly for two (Python fell back to Mann-Whitney/
  Kruskal-Wallis for the skewed ones — lactate p=0.220 vs 0.252, ICU LOS
  p=0.093 vs 0.067). Not wrong, just parametric-only — worth knowing before
  treating these p-values as final.
- **Multivariable logistic regression** — not reimplemented in JS; still
  Python-only (`analytics/cs_stats_engine.py --adjust ...`).
- **Confidence bands on the KM curve** — the deployed SVG draws the
  point-estimate step function only, no Greenwood confidence intervals
  (the Python/matplotlib version has them).

If you need the full rigor (normality-aware test selection, regression,
CI bands) for a manuscript-grade analysis, run the Python CLI locally on
the exported CSV and use its JSON output with `analytics/build_report.js`
as before — that path is unchanged and still the more rigorous one. The
deployed JS engine is for fast, always-available exploratory analysis
directly from the app, not a replacement for it.

## Required setup step before `/research` works

`APPS_SCRIPT_URL` must be set as an environment variable (Vercel: Project
Settings → Environment Variables) pointing at your deployed Apps Script Web
App URL (ends in `/exec`). Without it, `/api/research/submit` returns
`501` with an explicit message telling you that, rather than failing
silently — confirmed by testing locally.

## Verified locally before packaging
- `npm start` boots clean; `/`, `/research`, `/analysis` all return 200
- `/api/analyze` run against `analytics/sample_data.csv` (240 rows, 3
  groups) produces chi-square/ANOVA/log-rank results matching the earlier
  Python run to 2-3 decimal places (see divergence note above)
- `/api/research/submit` correctly returns 501 with a clear message when
  `APPS_SCRIPT_URL` is unset (expected state until you complete setup)

## Files in this package
```
server.js          — replaces the current one (adds the 4 new routes)
lib/stats.js        — new file
public/index.html   — same fix as before, plus new nav links
public/research.html — new file
public/analysis.html — new file
```
Drop these into the repo at the same paths (overwrite `server.js` and
`public/index.html`, add the rest), commit, redeploy.
