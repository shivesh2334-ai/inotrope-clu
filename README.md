# CS Vasoactive Platform

Clinical decision support and research data pipeline for cardiogenic shock vasoactive management.

## Repository structure

```
├── public/
│   └── index.html              # Clinical decision-support UI (browser, no server required)
├── analytics/
│   ├── cs_stats_engine.py      # Statistical analysis pipeline (Python)
│   ├── build_report.js         # Word manuscript report builder (Node.js)
│   └── sample_data.csv         # Synthetic demo dataset (240 rows)
├── google-apps-script/
│   └── sheet-provisioner.gs    # Research Hub sheet provisioner + data-collection webhook
├── server.js                   # Express web server entry point
├── package.json                # Node.js dependencies
└── requirements.txt            # Python dependencies
```

---

## Quick start

### 1. Web server (serves the UI)

```bash
npm install
npm start          # http://localhost:3000
```

Set `PORT` to override the default (`PORT=8080 npm start`).

### 2. Statistical analysis pipeline (Python)

```bash
pip install -r requirements.txt

python analytics/cs_stats_engine.py analytics/sample_data.csv \
  --group first_line_drug \
  --outcome mortality_30d \
  --continuous age,lactate_baseline,map_1h,icu_los_days \
  --categorical sex,scai_stage,aetiology \
  --time icu_los_days --event mortality_30d \
  --adjust scai_stage,lactate_baseline,age \
  --out results.json --figdir figures/
```

### 3. Manuscript report builder (Node.js)

```bash
# Requires results.json produced by the stats engine (rename to results_demo.json or update the path in build_report.js)
npm run report     # writes cs_manuscript_draft.docx
```

### 4. Research Hub — Google Apps Script

See `google-apps-script/sheet-provisioner.gs`.

1. Go to [script.google.com](https://script.google.com) and create a new standalone project.
2. Paste the contents of `sheet-provisioner.gs`.
3. Deploy as a **Web App** (Execute as: *Me*, Access: *Anyone with the link* or restricted to your domain).
4. Copy the Web App URL — use it as the `doPost` webhook endpoint for your data-entry form or mobile shortcut.
5. Call `createStudySheet(schema)` once from the Apps Script editor (or your backend) to provision a new study sheet.

---

## Evidence basis

Logic in the decision-support UI is derived from:

> Riccardi M, Pagnesi M, Chioncel O, et al. Medical therapy of cardiogenic shock: contemporary use of inotropes and vasopressors. *Eur J Heart Fail.* 2024;26:411–431. doi:10.1002/ejhf.3162

**Disclaimer.** No pharmacological therapy has proven mortality benefit in cardiogenic shock (DOREMI, LIDO, SURVIVE, SOAP-II). This tool encodes a therapeutic algorithm built from a mix of RCTs and observational registries and is intended to structure — not replace — bedside decision-making and invasive haemodynamic assessment.
