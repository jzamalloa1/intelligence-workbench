---
name: competitive-analysis
description: Compare companies, products or tools head to head — pricing, capabilities, positioning, traction. Use when the user asks how several named options stack up, which one to pick, or who leads a market.
---

# Competitive analysis

## Plan
- One `researcher` delegation per competitor (cap at 4; group the long tail as "others").
  Give every researcher the **same dimensions** so the answers line up.
- Default dimensions: pricing model and list price, core capabilities, target customer,
  distribution / go-to-market, traction signals (customers, revenue, funding, usage),
  notable weaknesses. Drop any the question makes irrelevant; add the ones it asks for.

## Evidence rules
- Prefer primary sources: pricing pages, docs, filings, the company's own announcements.
  Note the date on anything that changes (prices, funding, user counts).
- A missing data point is written as "not disclosed", never estimated silently.

## Output
- A comparison table in the report: one row per competitor, one column per dimension.
- One chart only when there is a like-for-like number to compare (e.g. price per seat,
  reported users) — `render_chart`, one unit per chart.
- Close with a short "which to pick when" section: the conditions under which each
  option wins, not a single winner unless the evidence is lopsided.
