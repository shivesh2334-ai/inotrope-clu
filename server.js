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

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Serve the clinical decision-support frontend
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "cs-vasoactive-platform" });
});

// Fallback: serve index.html for any unmatched GET (SPA-style)
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`CS Vasoactive Platform running on http://localhost:${PORT}`);
});
