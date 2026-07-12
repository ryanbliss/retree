import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.env.PREVIEW_DIR ?? "/tmp";
const times = process.argv.slice(2).map(Number);
const defaults = [1.6, 3.0, 6.0, 8.2, 11.7, 14.0, 18.0, 21.5, 23.2, 26.0, 28.5, 30.6, 33.0, 35.2, 37.0, 41.2];
const capture = times.length > 0 ? times : defaults;

const browser = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--force-device-scale-factor=1", "--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.error("CONSOLE:", msg.text());
});
const cutQuery = process.env.CUT === "short" ? "?cut=short" : "";
await page.goto("file://" + path.join(__dirname, "scene.html") + cutQuery, {
  waitUntil: "networkidle0",
});
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction("typeof window.seek === 'function'");
await new Promise((r) => setTimeout(r, 400));
for (const t of capture) {
  await page.evaluate((time) => window.seek(time), t);
  await page.screenshot({
    path: path.join(outDir, `retree-video-t${String(t).replace(".", "_")}.jpg`),
    type: "jpeg",
    quality: 85,
  });
  console.log("captured t=" + t);
}
await browser.close();
