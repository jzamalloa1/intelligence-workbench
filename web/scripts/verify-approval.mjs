/**
 * Verifies the approval card WITHOUT calling the agent (zero API cost): the
 * page's run request is answered with a synthetic stream that ends in the
 * `on_interrupt` custom event exactly as @ag-ui/langgraph emits it for
 * `interrupt_on`, then the card is driven and the resume payload the page sends
 * back is checked against the HumanInTheLoopMiddleware contract
 * (`{decisions: [one per action request]}`).
 *
 *   node scripts/verify-approval.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
fs.mkdirSync(OUT, { recursive: true });

// Produced by agent_core/approvals.describe_command for this command.
const command = `python3 - <<'PY'
import pandas as pd
df = pd.read_csv('/research/judge_costs.csv')
df.groupby('judge').mean().to_csv('/reports/judge_summary.csv')
PY
curl -s https://api.example.com/rates -o /data/rates.json`;
const description = `Run a short Python program.
Why: I'll average the cost and latency per judge from the collected measurements.
- Uses /research/judge_costs.csv
- Saves /reports/judge_summary.csv
- Saves /data/rates.json
! Connects to the internet`;

const hitlRequest = {
  action_requests: [{ name: "execute", args: { command }, description }],
  review_configs: [{ action_name: "execute", allowed_decisions: ["approve", "edit", "reject"] }],
};

function interruptStream(threadId, runId) {
  const ev = [
    { type: "RUN_STARTED", threadId, runId },
    { type: "TEXT_MESSAGE_START", messageId: "m1", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "I'll average the cost and latency per judge." },
    { type: "TEXT_MESSAGE_END", messageId: "m1" },
    { type: "CUSTOM", name: "on_interrupt", value: JSON.stringify(hitlRequest) },
    { type: "RUN_FINISHED", threadId, runId },
  ];
  return ev.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${msg}`);
  if (!ok) failures.push(msg);
};

async function scenario(name, act) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const runs = [];
  await page.route("**/api/copilotkit/agent/workbench/run", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    runs.push(body);
    const stream =
      runs.length === 1
        ? interruptStream(body.threadId, body.runId)
        : `data: ${JSON.stringify({ type: "RUN_STARTED", threadId: body.threadId, runId: body.runId })}\n\n` +
          `data: ${JSON.stringify({ type: "RUN_FINISHED", threadId: body.threadId, runId: body.runId })}\n\n`;
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: stream });
  });

  // The app sits behind demo sign-in; the cookie is shared by the page's context.
  await page.request.post(`${BASE}/api/session`, { data: { userId: "alex" } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.locator("textarea").first().fill(`approval check: ${name}`);
  await page.locator("textarea").first().press("Enter");
  await page.getByText("Your OK is needed").waitFor({ timeout: 15000 });
  await act(page, runs);
  check(errors.length === 0, `${name}: no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await browser.close();
  return runs;
}

function resumeOf(run) {
  // CopilotKit sends the resolve() payload as the LangGraph command resume.
  const r = run?.forwardedProps?.command?.resume;
  return typeof r === "string" ? JSON.parse(r) : r;
}

await scenario("approve", async (page, runs) => {
  check(await page.getByText("Run a short Python program.").isVisible(), "plain-language headline shown");
  check(await page.getByText("In the assistant’s words").isVisible(), "the agent's own reason is shown");
  check(await page.getByText("Connects to the internet").isVisible(), "warning shown");
  check(!(await page.getByText("import pandas as pd").isVisible()), "raw command hidden by default");
  await page.getByText("Show the exact command").click();
  check(await page.getByText("import pandas as pd").isVisible(), "raw command one click away");
  await page.screenshot({ path: `${OUT}/approval-card.png` });
  await page.getByRole("button", { name: "Run it" }).click();
  await page.waitForTimeout(800);
  check(JSON.stringify(resumeOf(runs[1])) === JSON.stringify({ decisions: [{ type: "approve" }] }), "approve sends {decisions:[{type:approve}]}");
});

await scenario("reject", async (page, runs) => {
  await page.getByRole("button", { name: "Don’t run" }).click();
  await page.getByPlaceholder("Tell the assistant why").fill("Skip the network call");
  await page.getByRole("button", { name: "Don’t run it" }).click();
  // The card is removed once the resumed run starts, so wait on the resume
  // request rather than on the brief confirmation line.
  await page.waitForTimeout(800);
  await page.waitForTimeout(500);
  check(
    JSON.stringify(resumeOf(runs[1])) ===
      JSON.stringify({ decisions: [{ type: "reject", message: "Skip the network call" }] }),
    "reject sends the reason",
  );
});

await scenario("edit", async (page, runs) => {
  await page.getByRole("button", { name: "Change it" }).click();
  await page.locator("textarea#edit-0").fill("python3 -c 'print(1)'");
  await page.getByRole("button", { name: "Run my version" }).click();
  await page.waitForTimeout(800);
  const d = resumeOf(runs[1])?.decisions?.[0];
  check(d?.type === "edit" && d.edited_action?.args?.command === "python3 -c 'print(1)'", "edit sends the new command");
});

console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshot in ${OUT}`);
process.exit(failures.length ? 1 : 0);
