---
name: data-analysis
description: Analyse numbers the user provides or that research turns up — clean them, compute comparisons or trends, and chart them. Use when the user shares data, asks for statistics, growth rates, correlations, or "what does this data say".
---

# Data analysis

## Workflow
1. **Get the data into the sandbox** — write it to a file under `/reports/` (CSV or JSON)
   with `write_file`, so the analysis and the user work from the same copy.
2. **Look before computing** — row counts, missing values, units, obvious outliers.
   State anything you drop or fix and why.
3. **Compute with `execute`** — a short pandas script; print the results you will cite.
   Growth as percentages with the period stated; correlations with their n, and never
   read as causation.
4. **Chart** — `render_chart`, one measure per unit, categories in a meaningful order
   (time order for trends, descending for rankings).

## Report
- Method in two or three sentences: source, cleaning, what was computed.
- Results as a table plus the chart; each claim traceable to a printed number.
- Limitations: sample size, coverage gaps, anything that would change the conclusion.
