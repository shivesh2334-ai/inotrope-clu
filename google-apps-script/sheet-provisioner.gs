/**
 * CS Vasoactive Platform — Research Hub sheet provisioner + collection webhook.
 *
 * Deploy as a standalone Apps Script project (script.google.com), bound to a
 * service account or your own Drive. Deploy as a Web App (Execute as: Me,
 * Access: Anyone with the link or restricted to your domain).
 *
 * Two entry points:
 *   1. createStudySheet(schema)  — called once per new study, from your
 *      Next.js backend after Claude turns a plain-language study
 *      description into a column schema.
 *   2. doPost(e)                 — webhook that appends a row of data to an
 *      existing study sheet. Point your data-entry form (or a Claude Tag
 *      workflow, or a mobile Shortcut) at the deployed Web App URL.
 *
 * Schema shape expected from the schema-builder step:
 * {
 *   "studyName": "CS vasoactive registry",
 *   "sheetId": null,                  // filled in on first call, reused after
 *   "columns": [
 *     {"name": "patient_id", "type": "string"},
 *     {"name": "first_line_drug", "type": "enum", "values": ["Norepinephrine","Dobutamine","Milrinone","Levosimendan","Norepinephrine+Dobutamine","Norepinephrine+Levosimendan"]},
 *     {"name": "aetiology", "type": "enum", "values": ["AMI-CS","ADHF-CS","RV-predominant"]},
 *     {"name": "scai_stage", "type": "enum", "values": ["A","B","C","D","E"]},
 *     {"name": "age", "type": "number"},
 *     {"name": "sex", "type": "enum", "values": ["Male","Female"]},
 *     {"name": "lactate_baseline", "type": "number"},
 *     {"name": "map_1h", "type": "number"},
 *     {"name": "icu_los_days", "type": "number"},
 *     {"name": "mortality_30d", "type": "boolean"}
 *   ]
 * }
 */

const ROOT_FOLDER_NAME = "CS Vasoactive Platform — Research Hub";
const REGISTRY_SHEET_NAME = "_study_registry"; // maps studyKey -> spreadsheetId, kept in the root folder

function getOrCreateRootFolder_() {
  const it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
}

function getRegistry_() {
  const folder = getOrCreateRootFolder_();
  const it = folder.getFilesByName(REGISTRY_SHEET_NAME);
  if (it.hasNext()) return SpreadsheetApp.open(it.next());
  const ss = SpreadsheetApp.create(REGISTRY_SHEET_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  const sh = ss.getActiveSheet();
  sh.appendRow(["studyKey", "studyName", "spreadsheetId", "createdAt"]);
  return ss;
}

function slugify_(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * Creates a new study sheet from a schema (idempotent by studyKey).
 * Call from your app backend with the JSON schema Claude produced.
 * Returns { studyKey, spreadsheetId, spreadsheetUrl }.
 */
function createStudySheet(schema) {
  const studyKey = slugify_(schema.studyName);
  const registry = getRegistry_();
  const regSheet = registry.getActiveSheet();
  const data = regSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === studyKey) {
      const existing = SpreadsheetApp.openById(data[i][2]);
      return { studyKey, spreadsheetId: data[i][2], spreadsheetUrl: existing.getUrl(), created: false };
    }
  }

  const ss = SpreadsheetApp.create(schema.studyName);
  DriveApp.getFileById(ss.getId()).moveTo(getOrCreateRootFolder_());
  const sheet = ss.getActiveSheet();
  const headers = schema.columns.map(c => c.name);
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#132126").setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);

  // enum columns get data validation dropdowns
  schema.columns.forEach((col, idx) => {
    if (col.type === "enum" && col.values && col.values.length) {
      const rule = SpreadsheetApp.newDataValidation().requireValueInList(col.values, true).build();
      sheet.getRange(2, idx + 1, 500, 1).setDataValidation(rule);
    }
  });

  regSheet.appendRow([studyKey, schema.studyName, ss.getId(), new Date().toISOString()]);
  return { studyKey, spreadsheetId: ss.getId(), spreadsheetUrl: ss.getUrl(), created: true };
}

/**
 * Webhook: POST a row of data keyed by column name.
 * Body: { "studyKey": "cs-vasoactive-registry", "row": { "patient_id": "P001", ... } }
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const registry = getRegistry_();
    const regSheet = registry.getActiveSheet();
    const data = regSheet.getDataRange().getValues();
    let spreadsheetId = null;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === body.studyKey) { spreadsheetId = data[i][2]; break; }
    }
    if (!spreadsheetId) {
      return jsonResponse_({ ok: false, error: `Unknown studyKey: ${body.studyKey}` }, 404);
    }
    const ss = SpreadsheetApp.openById(spreadsheetId);
    const sheet = ss.getActiveSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const row = headers.map(h => (h in body.row ? body.row[h] : ""));
    sheet.appendRow(row);
    return jsonResponse_({ ok: true, rowNumber: sheet.getLastRow() }, 200);
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err) }, 500);
  }
}

function jsonResponse_(obj, code) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Manual test — run from the Apps Script editor to sanity-check provisioning.
 */
function _test() {
  const schema = {
    studyName: "CS vasoactive registry",
    columns: [
      { name: "patient_id", type: "string" },
      { name: "first_line_drug", type: "enum", values: ["Norepinephrine", "Dobutamine", "Milrinone", "Levosimendan"] },
      { name: "aetiology", type: "enum", values: ["AMI-CS", "ADHF-CS", "RV-predominant"] },
      { name: "scai_stage", type: "enum", values: ["A", "B", "C", "D", "E"] },
      { name: "mortality_30d", type: "boolean" },
    ],
  };
  Logger.log(createStudySheet(schema));
}
