import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import ffmpegPath from "ffmpeg-static";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Two cuts: `node render.mjs` → full 44.5s; `node render.mjs short` → 29.9s.
const MODE = process.argv[2] === "short" ? "short" : "full";
const FPS = 30;
const DURATION = MODE === "short" ? 29.9 : 42.9;
const FRAMES = Math.round(FPS * DURATION);
const framesDir = path.join(__dirname, "frames");
const musicFile = path.join(
  __dirname,
  MODE === "short" ? "music-short.wav" : "music.wav",
);
const outFile = path.join(
  __dirname,
  MODE === "short" ? "retree-promo-short.mp4" : "retree-promo.mp4",
);

if (!existsSync(musicFile)) {
  console.log("Generating music…");
  const musicArgs = [path.join(__dirname, "music.mjs")];
  if (MODE === "short") musicArgs.push("short");
  execFileSync(process.execPath, musicArgs, { stdio: "inherit" });
}

rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

console.log("Launching Chrome…");
const browser = await puppeteer.launch({
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--force-device-scale-factor=1", "--hide-scrollbars", "--mute-audio"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
const sceneUrl =
  "file://" +
  path.join(__dirname, "scene.html") +
  (MODE === "short" ? "?cut=short" : "");
await page.goto(sceneUrl, {
  waitUntil: "networkidle0",
  timeout: 60_000,
});
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction("typeof window.seek === 'function'");
await new Promise((resolve) => setTimeout(resolve, 400));

console.log(`Capturing ${FRAMES} frames at ${FPS}fps…`);
const started = Date.now();
for (let frame = 0; frame < FRAMES; frame++) {
  const t = frame / FPS;
  await page.evaluate((time) => window.seek(time), t);
  await page.screenshot({
    path: path.join(framesDir, `frame_${String(frame).padStart(4, "0")}.jpg`),
    type: "jpeg",
    quality: 92,
  });
  if (frame % 90 === 0) {
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    console.log(`  frame ${frame}/${FRAMES} (${elapsed}s elapsed)`);
  }
}
await browser.close();
console.log("Frames captured. Encoding with ffmpeg…");

execFileSync(
  ffmpegPath,
  [
    "-y",
    // video: captured frames
    "-framerate", String(FPS),
    "-i", path.join(framesDir, "frame_%04d.jpg"),
    // audio: generated original track (royalty-free by construction)
    "-i", musicFile,
    "-af", MODE === "short"
      ? "volume=0.9,afade=t=out:st=27:d=2.9"
      : "volume=0.9,afade=t=out:st=39.9:d=3",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "19",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "160k",
    "-shortest",
    "-movflags", "+faststart",
    outFile,
  ],
  { stdio: "inherit" },
);

// Poster frame for social uploads (platforms that default to frame 0 are
// covered too — the video no longer opens on black).
const posterFile = outFile.replace(/\.mp4$/, "-poster.jpg");
execFileSync(
  ffmpegPath,
  ["-y", "-ss", "3.4", "-i", outFile, "-frames:v", "1", "-q:v", "2", posterFile],
  { stdio: "inherit" },
);
console.log("Done →", outFile, "+", posterFile);

// The full cut's poster doubles as the website's social-share image (Next.js
// picks up app/opengraph-image.jpg as the og:image / twitter:image for every
// page). Only the full cut owns it, so link previews stay stable regardless of
// which cut was rendered last. Skipped gracefully if the website is absent
// (e.g. rendering the video outside the monorepo).
if (MODE === "full") {
  const ogImageFile = path.join(
    __dirname,
    "..",
    "website",
    "app",
    "opengraph-image.jpg",
  );
  if (existsSync(path.dirname(ogImageFile))) {
    copyFileSync(posterFile, ogImageFile);
    console.log("Exported social image →", ogImageFile);
  } else {
    console.log("Skipped social image export: website/app not found.");
  }
}
