# Google Apps Script deployment

This directory contains `sheet-provisioner.gs`, a standalone Apps Script project
that provisions Google Sheets study spreadsheets and exposes a data-collection
webhook for the CS Vasoactive Platform Research Hub.

## Deploy

1. Open [script.google.com](https://script.google.com) and create a new **standalone** project.
2. Delete the default `Code.gs` content and paste the full contents of `sheet-provisioner.gs`.
3. Click **Deploy → New deployment**.
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: *Anyone with the link* (or restrict to your Google Workspace domain)
4. Click **Deploy** and copy the Web App URL.

## Entry points

| Function | How to call |
|----------|-------------|
| `createStudySheet(schema)` | Run once from the Apps Script editor, or call from your backend after generating a column schema |
| `doPost(e)` | HTTP POST webhook — point your data-entry form or mobile shortcut at the Web App URL |

## POST body format

```json
{
  "studyKey": "cs-vasoactive-registry",
  "row": {
    "patient_id": "P001",
    "first_line_drug": "Norepinephrine",
    "aetiology": "AMI-CS",
    "scai_stage": "C",
    "age": 67,
    "sex": "Male",
    "lactate_baseline": 4.2,
    "map_1h": 68,
    "icu_los_days": 8,
    "mortality_30d": false
  }
}
```
