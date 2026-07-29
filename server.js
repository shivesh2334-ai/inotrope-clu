/**
 * CS Vasoactive Platform — web server entry point.
 *
 * Serves the static clinical decision-support UI (public/index.html) and
 * exposes a lightweight REST API for data-row collection that mirrors the
 * Google Apps Script webhook in google-apps-script/sheet-provisioner.gs.
 *
 * Start:
 *   node server.js
 * or
 *   PORT=3000 node server.js
 */

const express = require("express");
const path = require("path");
const rateLimit = require("express-rate-limit");
const stats = require("./lib/stats");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "10mb" }));

// General-purpose rate limiter applied to all routes that touch the filesystem
// or run computation, to guard against abuse/DoS from repeated requests.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(generalLimiter);

// Serve the clinical decision-support frontend
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "cs-vasoactive-platform" });
});

/**
 * POST /api/analyze
 * Body: {
 *   rows: [{...}, ...],
 *   group: "column_name",
 *   continuous: ["col1", "col2"],
 *   categorical: ["col3"],
 *   time: "time_column",      // optional, enables Kaplan-Meier + log-rank
 *   event: "event_column"     // optional, 1 = event, 0 = censored
 * }
 */
app.post("/api/analyze", (req, res) => {
  const { rows, group, continuous = [], categorical = [], time, event } = req.body || {};

  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "rows must be a non-empty array" });
  }
  if (!group) {
    return res.status(400).json({ error: "group column is required" });
  }

  const groupValues = [...new Set(rows.map((r) => r[group]).filter((v) => v !== undefined && v !== null && v !== ""))];
  const rowsByGroup = groupValues.reduce((acc, g) => {
    acc[g] = rows.filter((r) => r[group] === g);
    return acc;
  }, {});

  const result = {
    n_total: rows.length,
    groups: Object.fromEntries(groupValues.map((g) => [g, rowsByGroup[g].length])),
    descriptive: {},
    comparisons: {},
  };

  for (const v of continuous) {
    const perGroup = {};
    const groupsArr = [];
    for (const g of groupValues) {
      const vals = rowsByGroup[g]
        .map((r) => parseFloat(r[v]))
        .filter((n) => !Number.isNaN(n));
      perGroup[g] = stats.describeContinuous(vals);
      groupsArr.push(vals);
    }
    result.descriptive[v] = perGroup;
    const cmp = stats.compareContinuous(groupsArr);
    if (cmp) result.comparisons[v] = cmp;
  }

  for (const v of categorical) {
    const categories = [...new Set(rows.map((r) => r[v]).filter((c) => c !== undefined && c !== null && c !== ""))];
    const perGroup = {};
    const table = [];
    for (const g of groupValues) {
      const groupRows = rowsByGroup[g];
      const counts = categories.map((c) => groupRows.filter((r) => r[v] === c).length);
      const total = groupRows.length || 1;
      perGroup[g] = Object.fromEntries(
        categories.map((c, i) => [c, Math.round((counts[i] / total) * 1000) / 10])
      );
      table.push(counts);
    }
    result.descriptive[v] = perGroup;
    const cmp = stats.chiSquareTest(table);
    if (cmp) result.comparisons[v] = { ...cmp, table: Object.fromEntries(groupValues.map((g, i) => [g, table[i]])) };
  }

  if (time && event) {
    const kmByGroup = {};
    const survivalAtEnd = {};
    for (const g of groupValues) {
      const groupRows = rowsByGroup[g].filter(
        (r) => r[time] !== undefined && r[time] !== null && r[time] !== "" && r[event] !== undefined && r[event] !== null && r[event] !== ""
      );
      const times = groupRows.map((r) => parseFloat(r[time]));
      const events = groupRows.map((r) => parseInt(r[event], 10));
      const steps = stats.kaplanMeier(times, events);
      kmByGroup[g] = steps;
      survivalAtEnd[g] = steps[steps.length - 1] ? steps[steps.length - 1].survival : null;
    }

    const allTimes = [];
    const allEvents = [];
    const allGroups = [];
    for (const g of groupValues) {
      for (const r of rowsByGroup[g]) {
        if (r[time] === undefined || r[time] === null || r[time] === "") continue;
        if (r[event] === undefined || r[event] === null || r[event] === "") continue;
        allTimes.push(parseFloat(r[time]));
        allEvents.push(parseInt(r[event], 10));
        allGroups.push(g);
      }
    }
    const logrank = stats.logRankTest(allTimes, allEvents, allGroups);

    result.kaplan_meier = {
      curves: kmByGroup,
      survival_at_last_followup: survivalAtEnd,
      logrank_p: logrank ? logrank.p_value : null,
      logrank_statistic: logrank ? logrank.statistic : null,
    };
  }

  res.json(result);
});

/**
 * POST /api/research/submit
 * Server-side proxy to the deployed Apps Script Web App (avoids the CORS
 * wall hit when calling script.googleusercontent.com from the browser).
 * Requires APPS_SCRIPT_URL to be set as an environment variable.
 */
app.post("/api/research/submit", async (req, res) => {
  const appsScriptUrl = process.env.APPS_SCRIPT_URL;
  if (!appsScriptUrl) {
    return res.status(501).json({
      error: "APPS_SCRIPT_URL is not configured. Set it as an environment variable pointing at your deployed Apps Script Web App URL (ends in /exec).",
    });
  }

  try {
    const upstream = await fetch(appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_err) {
      data = { raw: text };
    }
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(502).json({ error: "Failed to reach Apps Script Web App", detail: String(err) });
  }
});

// Friendly routes for the two new pages
app.get("/research", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "research.html"));
});
app.get("/analysis", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "analysis.html"));
});

// Fallback: serve index.html for any unmatched GET (SPA-style)
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start the server only when run directly (not when imported by Vercel serverless)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`CS Vasoactive Platform running on http://localhost:${PORT}`);
  });
}

module.exports = app;
