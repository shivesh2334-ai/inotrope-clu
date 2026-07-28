#!/usr/bin/env python3
"""
CS Stats Engine — reusable statistical analysis pipeline for cardiogenic shock
research data (vasoactive drug registries, outcome comparisons).

Usage:
    python cs_stats_engine.py data.csv \
        --group first_line_drug \
        --outcome mortality_30d \
        --continuous age,map_1h,lactate_baseline,icu_los_days \
        --categorical sex,scai_stage,aetiology \
        --time icu_los_days --event mortality_30d \
        --out results.json --figdir figures/

Outputs a JSON summary (results.json) with:
  - descriptive table (n, mean/SD or median/IQR, % by group)
  - group comparison tests (t-test/Mann-Whitney/ANOVA for continuous,
    chi-square/Fisher for categorical) with effect sizes where applicable
  - optional Kaplan-Meier survival estimates + log-rank test if --time/--event given
  - optional logistic regression for a binary outcome (--outcome) adjusted for
    covariates passed via --adjust

Designed to be pointed at data exported from a Google Sheet (research hub) or
any CSV/Excel research dataset. Every number in the downstream manuscript
report is pulled from this JSON — nothing is invented by the narrative layer.
"""
import argparse
import json
import os
import sys
import warnings

import numpy as np
import pandas as pd
from scipy import stats

warnings.filterwarnings("ignore")


def load_data(path):
    if path.endswith((".xlsx", ".xls")):
        return pd.read_excel(path)
    return pd.read_csv(path)


def describe_continuous(series):
    s = series.dropna()
    normal_p = None
    if len(s) >= 8:
        try:
            normal_p = float(stats.shapiro(s)[1])
        except Exception:
            normal_p = None
    is_normal = normal_p is not None and normal_p > 0.05
    if is_normal:
        return {
            "n": int(s.shape[0]), "mean": float(s.mean()), "sd": float(s.std()),
            "summary": f"{s.mean():.1f} \u00b1 {s.std():.1f}",
            "shapiro_p": normal_p, "distribution": "normal",
        }
    return {
        "n": int(s.shape[0]), "median": float(s.median()),
        "q1": float(s.quantile(0.25)), "q3": float(s.quantile(0.75)),
        "summary": f"{s.median():.1f} [{s.quantile(0.25):.1f}\u2013{s.quantile(0.75):.1f}]",
        "shapiro_p": normal_p, "distribution": "non-normal",
    }


def compare_continuous_by_group(df, var, group_col):
    groups = [g.dropna().values for _, g in df.groupby(group_col)[var]]
    groups = [g for g in groups if len(g) >= 2]
    if len(groups) < 2:
        return None
    normal = all(len(g) < 8 or stats.shapiro(g)[1] > 0.05 for g in groups)
    if len(groups) == 2:
        if normal:
            stat, p = stats.ttest_ind(groups[0], groups[1], equal_var=False)
            test = "Welch's t-test"
        else:
            stat, p = stats.mannwhitneyu(groups[0], groups[1], alternative="two-sided")
            test = "Mann-Whitney U"
    else:
        if normal:
            stat, p = stats.f_oneway(*groups)
            test = "one-way ANOVA"
        else:
            stat, p = stats.kruskal(*groups)
            test = "Kruskal-Wallis"
    return {"test": test, "statistic": float(stat), "p_value": float(p)}


def compare_categorical_by_group(df, var, group_col):
    table = pd.crosstab(df[group_col], df[var])
    if table.shape[0] < 2 or table.shape[1] < 2:
        return None
    if table.values.min() < 5 and table.shape == (2, 2):
        odds, p = stats.fisher_exact(table.values)
        return {"test": "Fisher's exact", "p_value": float(p), "table": table.to_dict()}
    chi2, p, dof, _ = stats.chi2_contingency(table.values)
    return {"test": "Chi-square", "statistic": float(chi2), "dof": int(dof),
            "p_value": float(p), "table": table.to_dict()}


def kaplan_meier(df, time_col, event_col, group_col, figdir):
    from lifelines import KaplanMeierFitter
    from lifelines.statistics import multivariate_logrank_test
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    os.makedirs(figdir, exist_ok=True)
    kmf = KaplanMeierFitter()
    fig, ax = plt.subplots(figsize=(7, 5))
    surv_at_end = {}
    for name, sub in df.groupby(group_col):
        sub = sub.dropna(subset=[time_col, event_col])
        if sub.empty:
            continue
        kmf.fit(sub[time_col], sub[event_col], label=str(name))
        kmf.plot_survival_function(ax=ax)
        surv_at_end[str(name)] = float(kmf.survival_function_.iloc[-1, 0])
    ax.set_xlabel(time_col)
    ax.set_ylabel("Survival probability")
    ax.set_title(f"Kaplan-Meier by {group_col}")
    path = os.path.join(figdir, "kaplan_meier.png")
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)

    lr = multivariate_logrank_test(df[time_col], df[group_col], df[event_col])
    return {"figure": path, "survival_at_last_followup": surv_at_end,
            "logrank_p": float(lr.p_value)}


def logistic_regression(df, outcome, covariates, figdir):
    import statsmodels.api as sm
    sub = df[[outcome] + covariates].dropna()
    X = pd.get_dummies(sub[covariates], drop_first=True).astype(float)
    X = sm.add_constant(X)
    y = sub[outcome].astype(float)
    model = sm.Logit(y, X).fit(disp=0)
    out = {}
    for name in model.params.index:
        if name == "const":
            continue
        or_val = float(np.exp(model.params[name]))
        ci = model.conf_int().loc[name]
        out[name] = {
            "OR": or_val, "CI_low": float(np.exp(ci[0])), "CI_high": float(np.exp(ci[1])),
            "p_value": float(model.pvalues[name]),
        }
    return {"n": int(sub.shape[0]), "pseudo_r2": float(model.prsquared), "estimates": out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("--group", required=True, help="grouping variable, e.g. first-line drug")
    ap.add_argument("--outcome", help="binary outcome column, e.g. mortality_30d")
    ap.add_argument("--continuous", default="", help="comma-separated continuous vars")
    ap.add_argument("--categorical", default="", help="comma-separated categorical vars")
    ap.add_argument("--time", help="survival time column")
    ap.add_argument("--event", help="survival event column (1=event)")
    ap.add_argument("--adjust", default="", help="comma-separated covariates for logistic model")
    ap.add_argument("--out", default="results.json")
    ap.add_argument("--figdir", default="figures")
    args = ap.parse_args()

    df = load_data(args.data)
    cont_vars = [v for v in args.continuous.split(",") if v]
    cat_vars = [v for v in args.categorical.split(",") if v]

    results = {"n_total": int(df.shape[0]), "groups": {}, "descriptive": {}, "comparisons": {}}

    for g, sub in df.groupby(args.group):
        results["groups"][str(g)] = int(sub.shape[0])

    for v in cont_vars:
        results["descriptive"][v] = {
            str(g): describe_continuous(sub[v]) for g, sub in df.groupby(args.group)
        }
        cmp = compare_continuous_by_group(df, v, args.group)
        if cmp:
            results["comparisons"][v] = cmp

    for v in cat_vars:
        results["descriptive"][v] = {
            str(g): sub[v].value_counts(normalize=True).mul(100).round(1).to_dict()
            for g, sub in df.groupby(args.group)
        }
        cmp = compare_categorical_by_group(df, v, args.group)
        if cmp:
            results["comparisons"][v] = cmp

    if args.time and args.event:
        results["kaplan_meier"] = kaplan_meier(df, args.time, args.event, args.group, args.figdir)

    if args.outcome and args.adjust:
        covars = [c for c in args.adjust.split(",") if c]
        results["logistic_regression"] = logistic_regression(df, args.outcome, covars, args.figdir)

    with open(args.out, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
