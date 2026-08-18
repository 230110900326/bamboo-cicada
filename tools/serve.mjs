// 极简静态文件服务器：node tools/serve.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT || process.argv[2] || 8734);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".md": "text/plain; charset=utf-8",
};

createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/hold") {   // 延迟响应：挂起页面 load 事件（无头验证用）
      const ms = Math.min(120000, Math.max(0, parseInt(u.searchParams.get("ms") || "10000", 10) || 10000));
      setTimeout(() => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("ok"); }, ms);
      return;
    }
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith("/")) p += "index.html";
    const file = normalize(join(root, p));
    if (!file.startsWith(root)) { res.writeHead(403); res.end("forbidden"); return; }
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(port, () => console.log("serving " + root + " at http://127.0.0.1:" + port));
