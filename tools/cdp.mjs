// CDP 无头浏览器验证驱动：node tools/cdp.mjs <mode> <url> <out>
// mode: selftest | shot-desktop | shot-mobile | shot-buzz
// 依赖 Node >= 22（内置 WebSocket）。浏览器：Edge/Chrome。
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "out");
mkdirSync(OUT_DIR, { recursive: true });

const [mode, url, outPath] = process.argv.slice(2);
if (!mode || !url || !outPath) { console.error("usage: node cdp.mjs <selftest|shot-desktop|shot-mobile|shot-buzz> <url> <out>"); process.exit(2); }

const BROWSERS = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter((p) => { try { readFileSync(p); return true; } catch { return false; } });
if (!BROWSERS.length) { console.error("no browser found"); process.exit(2); }

const PORT = 9333 + Math.floor(Math.random() * 200);
const proc = spawn(BROWSERS[0], [
  "--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--single-process", "--no-sandbox", "--disable-crash-reporter",
  "--no-first-run", "--no-default-browser-check",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${join(process.env.TEMP || ".", "zzl-cdp-profile-" + Math.floor(Math.random() * 1e6))}`,
  "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let msgId = 0;
const pending = new Map();
const events = { console: [], errors: [] };

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page) {
        const sock = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
        ws = sock;
        sock.onmessage = (ev) => {
          const m = JSON.parse(ev.data);
          if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
          if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
            events.console.push(m.params.type + ": " + m.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
          }
          if (m.method === "Runtime.exceptionThrown") events.errors.push(m.params.exceptionDetails.text);
        };
        return;
      }
    } catch { /* retry */ }
    await sleep(250);
  }
  throw new Error("CDP connect failed");
}
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression, awaitPromise = false) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
  if (r.result && r.result.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}

async function main() {
  await connect();
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 1200));   // 等首帧渲染

  if (mode === "selftest") {
    const deadline = Date.now() + 120000;
    let json = "";
    while (Date.now() < deadline) {
      json = await evaluate(`document.getElementById("selftest-output")?.textContent || ""`);
      if (json.includes('"done":true')) break;
      await sleep(400);
    }
    const out = { json, done: json.includes('"done":true'), console: events.console, errors: events.errors };
    writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    process.exitCode = out.done ? 0 : 1;
  } else if (mode === "shot-buzz") {
    // 合成画圈把竹知了搓起来，再截图看模糊环/鸣叫状态
    await evaluate(`(async () => {
      const dbg = window.__ZZL_DEBUG__; if (!dbg) return "no-debug";
      const cv = dbg.canvas; const rect = cv.getBoundingClientRect();
      const gs = dbg.getState();
      const cx = rect.left + gs.cx, cy = rect.top + gs.cy, r = Math.min(64, rect.width * 0.2);
      const fire = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", clientX: x, clientY: y, bubbles: true, cancelable: true }));
      fire("pointerdown", cx + r, cy);
      for (let i = 1; i <= 150; i++) { const a = (i / 150) * Math.PI * 2 * 6; fire("pointermove", cx + Math.cos(a) * r, cy + Math.sin(a) * r); await new Promise(r2 => setTimeout(r2, 12)); }
      fire("pointerup", cx + r, cy);
      await new Promise(r2 => setTimeout(r2, 400));
      const s = dbg.getState();
      return "w=" + s.w.toFixed(1) + " rpm=" + Math.round(s.rpm) + " buzz=" + s.buzzOn + " g=" + s.g.toFixed(2);
    })()`, true);
    await sleep(300);
    if (mode === "shot-buzz") {
      const shot = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(outPath, Buffer.from(shot.result.data, "base64"));
      console.log("shot saved: " + outPath);
    }
  } else {
    // shot-desktop / shot-mobile
    if (mode === "shot-mobile") {
      await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
      await sleep(600);
    }
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(outPath, Buffer.from(shot.result.data, "base64"));
    console.log("shot saved: " + outPath);
  }
  try { proc.kill(); } catch {}
  process.exit();
}

main().catch((e) => { console.error("CDP driver error:", e.message); try { proc.kill(); } catch {} process.exit(1); });
