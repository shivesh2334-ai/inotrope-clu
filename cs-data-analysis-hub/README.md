# CS Data Analysis Hub — starter kit

## What's here
- `cs_stats_engine.py` — reusable analysis pipeline (descriptive stats, group
  comparisons, Kaplan-Meier, adjusted logistic regression). Point it at any
  CSV/Excel export from the Research Hub Google Sheet, or an uploaded dataset.
- `sample_data.csv` — synthetic demo dataset (240 rows) used to prove the
  pipeline end-to-end. Not real patient data.
- `build_report.js` — renders the pipeline's JSON output into a Word
  manuscript draft (`cs_manuscript_draft.docx`), pulling every number
  directly from the computed stats — nothing narrated is invented.

## Run it on your own data
```bash
pip install pandas scipy statsmodels lifelines --break-system-packages

python cs_stats_engine.py your_data.csv \
  --group first_line_drug \
  --outcome mortality_30d \
  --continuous age,lactate_baseline,map_1h,icu_los_days \
  --categorical sex,scai_stage \
  --time icu_los_days --event mortality_30d \
  --adjust scai_stage,lactate_baseline,age \
  --out results.json --figdir figures/

node build_report.js   # reads results.json -> cs_manuscript_draft.docx
```

## Literature layer (not yet wired in)
The next step is a PubMed E-utilities pull keyed off the study's variables
(e.g. drug names + "cardiogenic shock") to source citable evidence for the
Discussion section, rather than relying on general web search. That's a
clean addition to `build_report.js` once you confirm you want citations
auto-inserted vs. hand-curated.

## Where this plugs into the Research Hub
`sheet-provisioner.gs` (in the parent outputs folder) creates and collects
into Google Sheets. Export a study's sheet to CSV (File > Download > CSV, or
via the Sheets API) and feed it straight into `cs_stats_engine.py` above.
