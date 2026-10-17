/**
 * Verifies file attachments WITHOUT calling the agent (zero API cost — the run
 * endpoint is stubbed). Checks what the browser sends, and how the reply is
 * shown once the agent has rewritten the message the way
 * agent/middleware/attachments.py does (files → `<attachment>` notes, images
 * kept):
 *   - the paperclip opens the picker; a CSV goes out as a document part with
 *     its real MIME type, a large image downscaled to Claude's 2576 px limit
 *   - the sent message shows the text and file chips, never the notes
 *   - files that are too large or of the wrong type are refused with a notice
 *   - Regenerate and Edit keep the files
 *
 *   node scripts/verify-attachments.mjs
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { parseNote, toLangChainContent, userText, withAttachmentChips, withUserText } from "../src/lib/attachments.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.env.OUT_DIR ?? path.resolve("scripts/.out");
fs.mkdirSync(OUT, { recursive: true });

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"} — ${msg}`);
  if (!ok) failures.push(msg);
};

const CSV = "region,revenue\nnorth,120\nsouth,95\n";
const note = (name, type, path, body) =>
  `<attachment name="${name}" type="${type}" size="1.0 KB" path="${path}">\n${body}\n</attachment>`;
const CSV_NOTE = note("sales.csv", "text/csv", "/workspace/attachments/sales.csv", `3 lines (2 data rows + header). Full contents:\n${CSV}`);
const IMG_NOTE = note("chart.png", "image/png", "/workspace/attachments/chart.png", "The image itself is attached to this message.");

// --- the helpers, without a browser
{
  check(parseNote(CSV_NOTE)?.path === "/workspace/attachments/sales.csv", "a note parses to its file's name, type and path");
  check(parseNote("<attachment> but typed by the user") === null, "text that only looks like a note stays text");
  const content = [{ type: "text", text: "Compare these" }, { type: "text", text: CSV_NOTE }];
  check(userText(content) === "Compare these", "the typed text excludes notes");
  const edited = withUserText(content, "Compare them by region");
  check(edited[0].text === "Compare them by region" && edited[1].text === CSV_NOTE, "an edit replaces the text and keeps the files");
  const lc = toLangChainContent([{ type: "image", source: { type: "data", value: "AAAA", mimeType: "image/png" } }]);
  check(lc[0].type === "image_url" && lc[0].image_url.url === "data:image/png;base64,AAAA", "a rewound image goes to LangGraph as an image_url block");
  const msgs = [{ id: "u", role: "user", content }, { id: "a", role: "assistant", content: "ok" }];
  const shown = withAttachmentChips(msgs);
  check(shown[0].content[1].type === "document" && shown[0].content[1].metadata.filename === "sales.csv", "a note is shown as a file chip");
  check(shown[1] === msgs[1], "other messages keep their identity");
}

let pngBytes = null;
function stream(body, n) {
  const user = body.messages.filter((m) => m.role === "user").at(-1);
  const parts = Array.isArray(user.content) ? user.content : [{ type: "text", text: user.content }];
  // The agent's rewrite: files out, notes in, images kept.
  const rewritten = [
    ...parts.filter((p) => p.type === "text" && !p.text.startsWith("<attachment")),
    ...parts.filter((p) => p.type === "image").map((p) => ({ ...p, metadata: { filename: "chart.png" } })),
    { type: "text", text: CSV_NOTE },
    { type: "text", text: IMG_NOTE },
  ];
  const ev = [
    { type: "RUN_STARTED", threadId: body.threadId, runId: body.runId },
    { type: "TEXT_MESSAGE_START", messageId: `ans-${n}`, role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: `ans-${n}`, delta: `North leads (${n}).` },
    { type: "TEXT_MESSAGE_END", messageId: `ans-${n}` },
    {
      type: "MESSAGES_SNAPSHOT",
      messages: [
        ...body.messages.filter((m) => m.role !== "user" || m.id !== user.id).filter((m) => m.role === "user" || m.role === "assistant"),
        { id: user.id, role: "user", content: rewritten },
        { id: `ans-${n}`, role: "assistant", content: `North leads (${n}).` },
      ],
    },
    { type: "RUN_FINISHED", threadId: body.threadId, runId: body.runId },
  ];
  return ev.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const runs = [];
await page.route("**/api/copilotkit/agent/*/run", async (route) => {
  const body = JSON.parse(route.request().postData() || "{}");
  runs.push(body);
  await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: stream(body, runs.length) });
});
const chat = page.locator("section", { has: page.getByRole("heading", { name: "Conversation" }) });
const fileInput = page.locator('input[type="file"]');

try {
  await page.request.post(`${BASE}/api/session`, { data: { userId: "alex" } });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const attach = chat.getByRole("button", { name: "Attach files" });
  check(await attach.isVisible(), "the input has an attach button");
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 3000 }).catch(() => null), attach.click()]);
  check(Boolean(chooser), "…which opens the file picker in one click");
  check((await fileInput.getAttribute("accept"))?.includes(".csv"), "the picker offers CSV among the accepted types");

  // A 4000×1000 PNG, drawn in the page.
  const pngB64 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 4000;
    c.height = 1000;
    const g = c.getContext("2d");
    g.fillStyle = "#2a78d6";
    g.fillRect(0, 0, 4000, 1000);
    return c.toDataURL("image/png").split(",")[1];
  });
  pngBytes = Buffer.from(pngB64, "base64");
  // Windows reports CSV as an Excel type; the extension should win.
  await fileInput.setInputFiles([
    { name: "sales.csv", mimeType: "application/vnd.ms-excel", buffer: Buffer.from(CSV) },
    { name: "chart.png", mimeType: "image/png", buffer: pngBytes },
  ]);
  await page.waitForTimeout(1500);
  const queue = page.getByTestId("copilot-attachment-queue");
  const queueTop = (await queue.boundingBox())?.y ?? 0;
  const welcomeBottom = await page
    .getByRole("heading", { name: /What should we research/ })
    .evaluate((h) => h.closest(".overflow-y-auto")?.getBoundingClientRect().bottom ?? 0);
  check(welcomeBottom > 0 && welcomeBottom <= queueTop, `queued files sit below the welcome screen, not over it (${Math.round(welcomeBottom)} ≤ ${Math.round(queueTop)})`);
  const chipBg = await queue.locator(":scope > div").first().evaluate((e) => getComputedStyle(e).backgroundColor);
  check(chipBg !== "rgba(0, 0, 0, 0)", `queued file chips have a surface (${chipBg})`);
  await page.locator("textarea").first().fill("Which region leads?");
  await page.locator("textarea").first().press("Enter");
  await chat.getByText("North leads (1).").first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);

  const sent = runs[0].messages.filter((m) => m.role === "user").at(-1).content;
  const doc = sent.find((p) => p.type === "document");
  const img = sent.find((p) => p.type === "image");
  check(sent[0]?.type === "text" && sent[0].text === "Which region leads?", "the typed text goes first");
  check(doc?.source?.mimeType === "text/csv" && doc?.metadata?.filename === "sales.csv", "the CSV is sent as text/csv with its filename");
  check(Buffer.from(doc?.source?.value ?? "", "base64").toString() === CSV, "…and its exact bytes");
  const dims = await page.evaluate(
    (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok([i.width, i.height]); i.src = src; }),
    `data:${img?.source?.mimeType};base64,${img?.source?.value}`,
  );
  check(dims[0] === 2576 && dims[1] === 644, `the 4000×1000 image is downscaled to 2576 px (${dims.join("×")})`);

  const bubble = chat.getByTestId("copilot-user-message").last();
  check(await bubble.getByText("Which region leads?").isVisible(), "the sent message shows what was typed");
  check(!(await bubble.getByText("<attachment", { exact: false }).count()), "…not the notes written for the model");
  const chip = bubble.getByRole("link", { name: "sales.csv" });
  check(await chip.isVisible(), "the CSV shows as a chip");
  check((await chip.evaluate((a) => getComputedStyle(a).pointerEvents)) === "none", "…a label, not a dead link");
  check((await bubble.locator("img").count()) === 1, "the image shows as one thumbnail");
  check(!(await bubble.getByRole("link", { name: "chart.png" }).count()), "…with no extra chip for it");
  const workspace = page.locator("section", { has: page.getByRole("heading", { name: "Workspace" }) });
  const row = workspace.getByRole("button", { name: /\/workspace\/attachments\/sales\.csv/ });
  check(await row.getByText("Attached by you").isVisible(), "the Workspace lists the CSV as attached by the user");
  await row.click();
  check(await page.getByRole("dialog").getByText("north,120").first().isVisible(), "…and opens its contents");
  await page.keyboard.press("Escape");
  const imageRow = workspace.getByRole("button", { name: /\/workspace\/attachments\/chart\.png/ });
  check(await imageRow.getByText("Attached by you · kept in the sandbox").isVisible(), "the image is listed too, as kept in the sandbox");
  await page.screenshot({ path: `${OUT}/attachments.png` });

  // --- refusals
  await fileInput.setInputFiles({ name: "big.csv", mimeType: "text/csv", buffer: Buffer.alloc(6 * 1024 * 1024, 97) });
  check(await page.getByRole("alert").getByText("larger than 5 MB").isVisible({ timeout: 3000 }).catch(() => false), "a file over 5 MB is refused with a reason");
  await page.getByRole("alert").getByRole("button", { name: "Dismiss" }).click();
  await fileInput.setInputFiles({ name: "tool.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  check(await page.getByRole("alert").getByText("isn't a supported file type").isVisible({ timeout: 3000 }).catch(() => false), "an unsupported type is refused with a reason");
  await page.getByRole("alert").getByRole("button", { name: "Dismiss" }).click();

  // --- regenerate and edit keep the files
  await chat.getByText("North leads (1).").first().hover();
  await chat.getByRole("button", { name: "Regenerate" }).last().click();
  await chat.getByText("North leads (2).").first().waitFor({ timeout: 10000 });
  const regen = runs[1]?.forwardedProps?.workbenchRewind?.content;
  check(Array.isArray(regen) && regen.some((p) => p.text === CSV_NOTE) && regen.some((p) => p.type === "image"), "Regenerate re-sends the question with its files");

  await bubble.getByText("Which region leads?").hover();
  await chat.getByRole("button", { name: "Edit" }).last().click();
  const bar = page.getByRole("form", { name: "Edit your message" });
  check((await bar.locator("textarea").inputValue()) === "Which region leads?", "Edit offers the typed text only");
  await bar.locator("textarea").fill("Which region trails?");
  await bar.getByRole("button", { name: "Re-run from here" }).click();
  await chat.getByText("North leads (3).").first().waitFor({ timeout: 10000 });
  const edit = runs[2]?.forwardedProps?.workbenchRewind?.content;
  check(Array.isArray(edit) && edit[0]?.text === "Which region trails?" && edit.some((p) => p.text === CSV_NOTE), "the edited question keeps its files");

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASS", `— screenshot in ${OUT}`);
process.exit(failures.length ? 1 : 0);
