const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, ShadingType, BorderStyle, AlignmentType, ImageRun,
} = require("docx");

const R = JSON.parse(fs.readFileSync("results_demo.json", "utf8"));
const groups = Object.keys(R.groups);

const PAGE = { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } };
const NAVY = "132126", TEAL = "0E6B66", SOFT = "48595E", LINE = "D8E1E1";

function h(text, level) {
  return new Paragraph({ text, heading: level, spacing: { before: 280, after: 140 } });
}
function p(text, opts = {}) {
  return new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { after: 140 } });
}
function cell(text, { header = false, width = 2000, bold = false } = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: header ? { type: ShadingType.CLEAR, fill: NAVY } : undefined,
    children: [new Paragraph({ children: [new TextRun({ text: String(text), bold: header || bold, color: header ? "FFFFFF" : NAVY, size: 20 })] })],
  });
}

function descTable() {
  const vars = Object.keys(R.descriptive).filter(v => R.descriptive[v][groups[0]].summary !== undefined);
  const colW = Math.floor(9360 / (groups.length + 1));
  const header = new TableRow({ children: [cell("Variable", { header: true, width: colW }), ...groups.map(g => cell(`${g}\n(n=${R.groups[g]})`, { header: true, width: colW }))] });
  const rows = vars.map(v => new TableRow({
    children: [cell(v.replace(/_/g, " "), { width: colW, bold: true }),
      ...groups.map(g => cell(R.descriptive[v][g].summary, { width: colW }))],
  }));
  return new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: Array(groups.length + 1).fill(colW), rows: [header, ...rows] });
}

function comparisonList() {
  return Object.entries(R.comparisons).map(([v, c]) => {
    const sig = c.p_value < 0.05 ? " *" : "";
    return p(`${v.replace(/_/g, " ")}: ${c.test}, p = ${c.p_value.toFixed(3)}${sig}`, { size: 21, color: SOFT });
  });
}

function logisticTable() {
  if (!R.logistic_regression) return [];
  const est = R.logistic_regression.estimates;
  const colW = 2340;
  const header = new TableRow({ children: [cell("Covariate", { header: true, width: colW }), cell("OR", { header: true, width: colW }), cell("95% CI", { header: true, width: colW }), cell("p", { header: true, width: colW })] });
  const rows = Object.entries(est).map(([name, e]) => new TableRow({
    children: [cell(name, { width: colW }), cell(e.OR.toFixed(2), { width: colW }),
      cell(`${e.CI_low.toFixed(2)}\u2013${e.CI_high.toFixed(2)}`, { width: colW }),
      cell(e.p_value.toFixed(3), { width: colW })],
  }));
  return [
    h("Multivariable logistic regression — 30-day mortality", HeadingLevel.HEADING_2),
    p(`n = ${R.logistic_regression.n}, pseudo-R\u00b2 = ${R.logistic_regression.pseudo_r2.toFixed(3)}. Adjusted odds ratios below; OR > 1 indicates higher odds of 30-day mortality.`, { size: 21, color: SOFT }),
    new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: Array(4).fill(colW), rows: [header, ...rows] }),
  ];
}

async function kmSection() {
  if (!R.kaplan_meier) return [];
  const img = fs.readFileSync(R.kaplan_meier.figure);
  const survLines = Object.entries(R.kaplan_meier.survival_at_last_followup)
    .map(([g, s]) => `${g}: ${(s * 100).toFixed(1)}%`).join("  |  ");
  return [
    h("Time-to-event analysis", HeadingLevel.HEADING_2),
    p(`Log-rank test across ${groups.length} groups: p = ${R.kaplan_meier.logrank_p.toFixed(3)}.`, { size: 21, color: SOFT }),
    p(`Estimated survival at last follow-up — ${survLines}`, { size: 21, color: SOFT }),
    new Paragraph({ children: [new ImageRun({ data: img, type: "png", transformation: { width: 480, height: 340 } })] }),
  ];
}

(async () => {
  const km = await kmSection();
  const doc = new Document({
    sections: [{
      properties: { page: PAGE },
      children: [
        new Paragraph({ children: [new TextRun({ text: "TEMPLATE OUTPUT — GENERATED FROM SYNTHETIC DEMO DATA", bold: true, color: "A3352E", size: 18 })], spacing: { after: 60 } }),
        new Paragraph({ children: [new TextRun({ text: "Replace cs_registry_demo.csv with your own dataset and re-run cs_stats_engine.py to regenerate this report with real figures.", italics: true, color: SOFT, size: 18 })], spacing: { after: 220 } }),

        new Paragraph({ children: [new TextRun({ text: "First-Line Vasoactive Strategy and Outcomes in Cardiogenic Shock: A Registry Analysis", bold: true, size: 30, color: NAVY })], spacing: { after: 100 } }),
        p(`Draft generated ${new Date().toISOString().slice(0, 10)} · EMC Digitals — CS Vasoactive Platform`, { italics: true, color: SOFT, size: 20 }),

        h("Methods", HeadingLevel.HEADING_1),
        p(`We analysed ${R.n_total} patients with cardiogenic shock stratified by initial vasoactive strategy (${groups.join(", ")}). Continuous variables are reported as mean \u00b1 SD when the Shapiro-Wilk test did not reject normality (p > 0.05), and as median [IQR] otherwise. Between-group comparisons used Welch's t-test or one-way ANOVA for normally distributed continuous variables, Mann-Whitney U or Kruskal-Wallis for non-normal variables, and chi-square or Fisher's exact test for categorical variables as appropriate to expected cell counts. Time-to-event analysis used the Kaplan-Meier method with the log-rank test. A multivariable logistic regression model for 30-day mortality was adjusted for SCAI shock stage, baseline lactate, and age. Statistical significance was set at two-sided p < 0.05.`),

        h("Results", HeadingLevel.HEADING_1),
        p(`Baseline and outcome characteristics by first-line vasoactive strategy are shown in Table 1.`),
        descTable(),
        new Paragraph({ text: "", spacing: { before: 160 } }),
        h("Between-group comparisons", HeadingLevel.HEADING_2),
        ...comparisonList(),
        ...km,
        ...logisticTable(),

        h("Discussion", HeadingLevel.HEADING_1),
        p("[Populate after reviewing the computed results above against the study's clinical context and the existing literature — e.g. Riccardi et al. Eur J Heart Fail 2024;26:411\u2013431 for the pharmacological rationale and prior trial evidence (SOAP-II, OptimaCC, DOREMI, LIDO/SURVIVE) to compare against.]", { italics: true, color: SOFT }),

        h("Limitations", HeadingLevel.HEADING_1),
        p("[Registry/observational design — confounding by indication is expected (sicker patients more likely to receive combination therapy); document data completeness, missingness handling, and any propensity-adjustment performed.]", { italics: true, color: SOFT }),
      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync("cs_manuscript_draft.docx", buf);
  console.log("wrote cs_manuscript_draft.docx");
})();
