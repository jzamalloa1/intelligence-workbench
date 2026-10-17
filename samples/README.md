# Sample attachments

One fictional business case, Brightline Coffee Co., deciding whether to launch a canned cold
brew. Each file exercises a different path:

| File | What it tests |
|---|---|
| `brightline-sales-2024-2025.csv` | 289 rows of monthly sales by region and product line. At 14.6 KB it is over the 12,000-character limit for sending a file whole, so the agent gets a 20-line preview and has to open the full file in the sandbox (`execute`, which asks for your approval). Two planted quirks: one row exported twice, and one row with no cost. |
| `brightline-board-memo.pdf` | A two-page memo. The agent reads its extracted text. It holds market claims that are deliberately unchecked (for the web research) and the launch economics (for the math and the widget). |
| `competitor-shelf-prices.png` | Six competitor cans with shelf tags. The prices exist only in the image, so the model has to read them. |

Everything here is made up, including the brands on the shelf. Regenerate the files with
`node web/scripts/make-samples.mjs` (deterministic, no model calls).

## The full test

Attach all three files with the paperclip and send:

> Should Brightline launch the canned cold brew in 2026? Use the attached sales export, board memo
> and shelf photo.
>
> 1. Analyse the full sales file in the sandbox: revenue and gross margin by product line for 2024
>    and 2025, and cold brew growth by region. Tell me about any data problems you find.
> 2. Check the memo's market size and growth figures against current public sources.
> 3. Read the competitor prices off the photo and recommend a shelf price that clears the 35% margin.
> 4. Work out the payback on the $2.5M budget at the planned volumes.
>
> Give me a dashboard with the headline numbers, write the full report, and add a small interactive
> widget where I can change shelf price, unit cost and monthly volume to see margin and payback.

What you should see, by feature:

| Feature | Where |
|---|---|
| Attachments | Three chips on your message. The Workspace lists the files as "Attached by you", and the CSV opens there. |
| Planning | A plan of several steps on the Plan board, updated as the agent works. |
| Research lanes | Two or three researchers checking the market figures, using `research` and maybe `fetch_url`. |
| Approval | An approval card for the Python that reads the CSV. The sandbox console shows its output. |
| Vision | The six shelf prices quoted correctly, from the image. |
| Charts | At least one chart, such as cold brew revenue by region or product line margins. |
| Dashboard | Metric tiles (recommended price, margin, payback, cold brew growth) and a chart, in the chat. |
| Report | `/reports/…md` in the Workspace, with charts embedded. |
| Widget | A sandboxed calculator in the chat with price, cost and volume controls. |

It is a full research run plus a report and a widget, so expect it to cost more than a normal
question: roughly $1–3 plus Tavily searches. That figure is an estimate; it hasn't been run.

## Answer key

These figures come from the CSV (with the duplicate removed and the row with no cost left out) and
the memo's assumptions. Use them to check the agent's numbers.

**Data problems:** `2025-05, South, Iced & cold brew` appears twice. `2025-01, Midwest, Pastries`
has no `cogs_usd`.

| Product line | 2024 revenue | 2024 margin | 2025 revenue | 2025 margin |
|---|---|---|---|---|
| Hot coffee | $4.18M | 67.9% | $4.14M | 67.9% |
| Iced & cold brew | $2.88M | 71.9% | $4.23M | 72.2% |
| Pastries | $1.98M | 45.0% | $2.10M | 45.1% |

**Cold brew growth:** +47% overall, from $2.88M to $4.23M. By region in 2025: West $1.56M (+50%),
Northeast $1.02M (+47%), South $1.00M (+42%), Midwest $0.65M (+47%). West is the right first
region, as the memo says.

**Shelf prices in the photo:** Summit $3.49, Harbor Black $2.99, Night Owl Nitro $3.99, Grove $3.79,
Cascade $3.29, FreshMart $2.29.

**Unit economics** (net = 55% of shelf price; landed cost $1.15). A 35% margin needs a shelf price of
at least **$3.22**.

| Shelf price | Net per can | Margin | Payback at 120k / 150k / 180k cans a month |
|---|---|---|---|
| $2.99 | $1.64 | 30.1% | 42 / 34 / 28 months |
| $3.29 | $1.81 | 36.4% | 32 / 25 / 21 months |
| $3.49 | $1.92 | 40.1% | 27 / 22 / 18 months |
| $3.79 | $2.08 | 44.8% | 22 / 18 / 15 months |

Payback here is gross margin only, before any operating costs. The tension is that $3.29 clears
the margin but misses the 24-month payback target unless volume reaches about 160k cans a month,
while $3.49 matches the category leader and pays back in 22 months at 150k. A good answer surfaces
that trade-off.

**Market figures:** the memo's $5.2B and 9% are deliberately unverified. The agent should report
what current sources say and flag any gap, not repeat the memo's numbers.

## Cheaper checks, one feature at a time

| Feature | Attach | Ask |
|---|---|---|
| Attachments + vision | the PNG | "List every product and shelf price in the photo." |
| PDF | the PDF | "Summarise the memo's unit-economics assumptions in a table. No research." |
| Sandbox | the CSV | "Using the full file in the sandbox, what was 2025 revenue by product line? Note any data issues." |
| Dashboard | nothing | "No research. Cold brew revenue by region in 2025: West 1.56M, Northeast 1.02M, South 1.00M, Midwest 0.65M. Chart it and give me a dashboard." |
| Widget | the PDF | "No research. Build a widget from the memo's economics with sliders for shelf price, unit cost and monthly volume showing margin and payback." |
