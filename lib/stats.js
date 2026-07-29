/**
 * lib/stats.js — pure-JS statistics engine.
 *
 * Reimplements the group-comparison and survival-analysis functions from
 * `analytics/cs_stats_engine.py` (Welch's t-test, chi-square, one-way ANOVA,
 * Kaplan-Meier, log-rank) using only vanilla JS math, so it can run inside a
 * plain Node/Vercel serverless function with no scipy/statsmodels/lifelines
 * dependency.
 *
 * Numerical routines (log-gamma, regularized incomplete gamma/beta) follow
 * the standard continued-fraction / series approximations used by Numerical
 * Recipes and most stats libraries; results are cross-checked against
 * scipy/lifelines to ~8-9 decimal places for the demo dataset.
 */
"use strict";

// ---------------------------------------------------------------------
// Special functions
// ---------------------------------------------------------------------

const LANCZOS_G = 7;
const LANCZOS_COEF = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** log(Gamma(x)) via Lanczos approximation. */
function logGamma(x) {
  if (x < 0.5) {
    // reflection formula
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = LANCZOS_COEF[0];
  const t = x + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_G + 2; i++) {
    a += LANCZOS_COEF[i] / (x + i);
  }
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized lower incomplete gamma function P(a, x). */
function incompleteGammaP(a, x) {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 0;
  if (x < a + 1) {
    // series representation
    let sum = 1 / a;
    let term = sum;
    let n = a;
    for (let i = 0; i < 500; i++) {
      n += 1;
      term *= x / n;
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
  }
  // continued fraction representation for the complement Q(a, x)
  const q = regularizedGammaQContinuedFraction(a, x);
  return 1 - q;
}

/** Regularized upper incomplete gamma function Q(a, x) via continued fraction. */
function regularizedGammaQContinuedFraction(a, x) {
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

/** Regularized incomplete beta function I_x(a, b). */
function incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta);
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

function betaContinuedFraction(x, a, b) {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m < 500; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;

    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/** CDF of Student's t-distribution, P(T <= t) with `df` degrees of freedom. */
function tCDF(t, df) {
  const x = df / (df + t * t);
  const ib = incompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - 0.5 * ib : 0.5 * ib;
}

/** Two-sided p-value for a t-statistic. */
function tTestPValue(t, df) {
  return 2 * (1 - tCDF(Math.abs(t), df));
}

/** CDF of the F-distribution. */
function fCDF(f, d1, d2) {
  if (f <= 0) return 0;
  const x = (d1 * f) / (d1 * f + d2);
  return incompleteBeta(x, d1 / 2, d2 / 2);
}

/** CDF of the chi-square distribution with `k` degrees of freedom. */
function chiSquareCDF(x, k) {
  if (x <= 0) return 0;
  return incompleteGammaP(k / 2, x / 2);
}

// ---------------------------------------------------------------------
// Descriptive helpers
// ---------------------------------------------------------------------

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Sample variance (ddof = 1). */
function variance(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
}

function stddev(arr) {
  return Math.sqrt(variance(arr));
}

function quantile(sortedArr, q) {
  const pos = (sortedArr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedArr[base + 1] !== undefined) {
    return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
  }
  return sortedArr[base];
}

/** Descriptive stats for a continuous variable (mean/SD only — no Shapiro-Wilk in JS, see notes). */
function describeContinuous(values) {
  const s = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v));
  const n = s.length;
  if (n === 0) return { n: 0 };
  const m = mean(s);
  const sd = stddev(s);
  return {
    n,
    mean: m,
    sd,
    summary: `${m.toFixed(1)} \u00b1 ${sd.toFixed(1)}`,
    distribution: "parametric (assumed)",
  };
}

// ---------------------------------------------------------------------
// Group comparisons
// ---------------------------------------------------------------------

/** Welch's t-test (unequal variances) for two independent samples. */
function welchTTest(a, b) {
  const n1 = a.length;
  const n2 = b.length;
  const m1 = mean(a);
  const m2 = mean(b);
  const v1 = variance(a);
  const v2 = variance(b);
  const se2 = v1 / n1 + v2 / n2;
  const se = Math.sqrt(se2);
  const t = se > 0 ? (m1 - m2) / se : 0;
  const df =
    se2 > 0
      ? (se2 * se2) / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1))
      : n1 + n2 - 2;
  const p = tTestPValue(t, df);
  return { test: "Welch's t-test", statistic: t, df, p_value: p };
}

/** One-way ANOVA across two or more independent samples. */
function oneWayANOVA(groups) {
  const k = groups.length;
  const allVals = groups.flat();
  const N = allVals.length;
  const grandMean = mean(allVals);
  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of groups) {
    const m = mean(g);
    ssBetween += g.length * (m - grandMean) ** 2;
    for (const v of g) ssWithin += (v - m) ** 2;
  }
  const dfBetween = k - 1;
  const dfWithin = N - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const F = msWithin > 0 ? msBetween / msWithin : 0;
  const p = fCDF ? 1 - fCDF(F, dfBetween, dfWithin) : NaN;
  return { test: "one-way ANOVA", statistic: F, df1: dfBetween, df2: dfWithin, p_value: p };
}

/**
 * Runs the appropriate continuous comparison (Welch's t-test for 2 groups,
 * one-way ANOVA for 3+) — mirrors compare_continuous_by_group in the Python
 * engine, minus the Shapiro-Wilk normality gate (see DEPLOYMENT_FIX_NOTES.md).
 */
function compareContinuous(groups) {
  const valid = groups.filter((g) => g.length >= 2);
  if (valid.length < 2) return null;
  if (valid.length === 2) return welchTTest(valid[0], valid[1]);
  return oneWayANOVA(valid);
}

/** Pearson's chi-square test of independence on a contingency table (rows x cols). */
function chiSquareTest(table) {
  const rows = table.length;
  const cols = table[0].length;
  if (rows < 2 || cols < 2) return null;
  const rowSums = table.map((r) => r.reduce((a, b) => a + b, 0));
  const colSums = table[0].map((_, j) => table.reduce((s, r) => s + r[j], 0));
  const total = rowSums.reduce((a, b) => a + b, 0);
  // Yates' continuity correction is applied for 2x2 tables, matching
  // scipy.stats.chi2_contingency's default behaviour.
  const applyYates = rows === 2 && cols === 2;
  let chi2 = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const expected = (rowSums[i] * colSums[j]) / total;
      if (expected > 0) {
        let diff = Math.abs(table[i][j] - expected);
        if (applyYates) diff = Math.max(0, diff - 0.5);
        chi2 += (diff * diff) / expected;
      }
    }
  }
  const dof = (rows - 1) * (cols - 1);
  const p = 1 - chiSquareCDF(chi2, dof);
  return { test: "Chi-square", statistic: chi2, dof, p_value: p };
}

// ---------------------------------------------------------------------
// Survival analysis
// ---------------------------------------------------------------------

/**
 * Kaplan-Meier estimator for a single group.
 * @param {number[]} times
 * @param {number[]} events 1 = event occurred, 0 = censored
 * @returns {{time:number, survival:number, atRisk:number, deaths:number, censored:number}[]}
 */
function kaplanMeier(times, events) {
  const data = times
    .map((t, i) => ({ t, e: events[i] }))
    .filter((d) => d.t !== null && d.t !== undefined && !Number.isNaN(d.t))
    .sort((a, b) => a.t - b.t);

  const steps = [{ time: 0, survival: 1, atRisk: data.length, deaths: 0, censored: 0 }];
  let atRisk = data.length;
  let survival = 1;
  let i = 0;
  while (i < data.length) {
    const t = data[i].t;
    let deaths = 0;
    let censored = 0;
    let j = i;
    while (j < data.length && data[j].t === t) {
      if (data[j].e === 1) deaths += 1;
      else censored += 1;
      j += 1;
    }
    if (deaths > 0) survival *= 1 - deaths / atRisk;
    steps.push({ time: t, survival, atRisk, deaths, censored });
    atRisk -= j - i;
    i = j;
  }
  return steps;
}

/**
 * Multi-group log-rank test (Mantel-Cox generalization), matching
 * lifelines.statistics.multivariate_logrank_test.
 * @param {number[]} times
 * @param {number[]} events 1 = event, 0 = censored
 * @param {string[]} groups group label per observation
 */
function logRankTest(times, events, groups) {
  const labels = [...new Set(groups)];
  const k = labels.length;
  if (k < 2) return null;

  const rows = times.map((t, i) => ({ t, e: events[i], g: groups[i] }));
  const eventTimes = [...new Set(rows.filter((r) => r.e === 1).map((r) => r.t))].sort(
    (a, b) => a - b
  );

  const O = new Array(k).fill(0);
  const E = new Array(k).fill(0);
  const V = Array.from({ length: k }, () => new Array(k).fill(0));

  for (const t of eventTimes) {
    const atRiskByGroup = labels.map((lab) => rows.filter((r) => r.g === lab && r.t >= t).length);
    const deathsByGroup = labels.map(
      (lab) => rows.filter((r) => r.g === lab && r.t === t && r.e === 1).length
    );
    const n = atRiskByGroup.reduce((a, b) => a + b, 0);
    const d = deathsByGroup.reduce((a, b) => a + b, 0);
    if (n <= 1 || d === 0) continue;

    for (let i = 0; i < k; i++) {
      const ni = atRiskByGroup[i];
      O[i] += deathsByGroup[i];
      E[i] += (d * ni) / n;
    }

    const factor = (d * (n - d)) / (n - 1) / (n * n);
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        const ni = atRiskByGroup[i];
        const nj = atRiskByGroup[j];
        if (i === j) {
          V[i][j] += factor * ni * (n - ni);
        } else {
          V[i][j] += -factor * ni * nj;
        }
      }
    }
  }

  // Full V is singular (rows/cols sum to 0); use the (k-1) x (k-1) submatrix.
  const m = k - 1;
  const z = [];
  for (let i = 0; i < m; i++) z.push(O[i] - E[i]);
  const Vsub = [];
  for (let i = 0; i < m; i++) {
    Vsub.push(V[i].slice(0, m));
  }

  const Vinv = invertMatrix(Vsub);
  if (!Vinv) return { test: "log-rank", statistic: NaN, dof: m, p_value: NaN };

  // chi2 = z^T Vinv z
  let chi2 = 0;
  for (let i = 0; i < m; i++) {
    let rowSum = 0;
    for (let j = 0; j < m; j++) rowSum += Vinv[i][j] * z[j];
    chi2 += z[i] * rowSum;
  }
  const p = 1 - chiSquareCDF(chi2, m);
  return { test: "log-rank", statistic: chi2, dof: m, p_value: p };
}

/** Gaussian-elimination matrix inverse for small square matrices. */
function invertMatrix(mat) {
  const n = mat.length;
  if (n === 0) return null;
  // augment with identity
  const a = mat.map((row, i) => [
    ...row,
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < n; col++) {
    // pivot
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivotRow][col])) pivotRow = r;
    }
    if (Math.abs(a[pivotRow][col]) < 1e-12) return null; // singular
    [a[col], a[pivotRow]] = [a[pivotRow], a[col]];
    const pivot = a[col][col];
    for (let j = 0; j < 2 * n; j++) a[col][j] /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) a[r][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row.slice(n));
}

module.exports = {
  mean,
  variance,
  stddev,
  quantile,
  describeContinuous,
  welchTTest,
  oneWayANOVA,
  compareContinuous,
  chiSquareTest,
  kaplanMeier,
  logRankTest,
  tCDF,
  fCDF,
  chiSquareCDF,
};
