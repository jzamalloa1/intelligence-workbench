---
name: market-sizing
description: Estimate the size of a market (TAM / SAM / SOM) with explicit assumptions. Use when the user asks how big a market is, how much a segment is worth, or for a revenue opportunity estimate.
---

# Market sizing

## Two independent estimates
1. **Top-down** — start from a published total (analyst report, government statistics)
   and narrow it by segment shares.
2. **Bottom-up** — number of buyers × adoption rate × annual spend per buyer.

Delegate the evidence for each input to researchers; do the arithmetic yourself.

## Compute, don't assert
- Run the numbers with `execute` (a short Python script) so every figure is reproducible,
  and write the script and its output to `/reports/`.
- Carry a low / base / high value for each assumption and report the resulting range,
  not a single point.
- If the two estimates differ by more than ~2x, say which assumption drives the gap.

## Output
- An assumptions table: input, value (low/base/high), source, date.
- TAM, SAM and SOM with one sentence each defining the boundary.
- A bar chart of the range (`render_chart`, unit stated), and the sensitivity: which
  single assumption moves the result most.
