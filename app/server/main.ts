/**
 * Catchment server: serves the built app (app/dist) and a small AI API.
 *
 *   node server/main.ts            (Node ≥ 22.18 runs TypeScript directly)
 *
 * Environment:
 *   OPENAI_API_KEY        enables AI routes; without it they answer 503 and the UI hides AI
 *   PORT                  default 8787
 *   AI_DAILY_BUDGET_USD   estimated spend cap per UTC day, default 3
 *
 * The OpenAI key is read here and nowhere else. It is never sent to the browser.
 */
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { MODEL, openAiLlm } from "./ai/llm.ts";
import { createApi } from "./api.ts";
import { DataStore } from "./data.ts";
import { DailyBudget, LruCache, RateLimiter } from "./guards.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 8 * 1024;

const key = process.env.OPENAI_API_KEY?.trim();
const api = createApi({
  data: new DataStore(path.join(ROOT, "public", "data")),
  llm: key ? openAiLlm(key) : null,
  limiter: new RateLimiter(12, 5 * 60_000),
  budget: new DailyBudget(Number(process.env.AI_DAILY_BUDGET_USD ?? 3)),
  cache: new LruCache(300),
  model: MODEL,
});

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
};
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".json", ".svg"]);
const gzCache = new Map<string, Buffer>();

function clientId(req: IncomingMessage): string {
  // Behind Render's proxy the first X-Forwarded-For entry is the client.
  const fwd = req.headers["x-forwarded-for"];
  return (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("too large"), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
  } catch {
    throw Object.assign(new Error("bad json"), { status: 400 });
  }
}

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  let file = path.normalize(path.join(DIST, urlPath));
  if (!file.startsWith(DIST)) return send(res, 400, { error: { code: "bad_path", message: "Bad path." } });
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, "index.html"); // hash routing: one page
  if (!existsSync(file)) return send(res, 404, { error: { code: "no_build", message: "Run `npm run build` first." } });

  const ext = path.extname(file);
  const headers: Record<string, string> = {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Hashed assets never change; data refreshes hourly; the page itself always revalidates.
    "Cache-Control": urlPath.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : urlPath.startsWith("/data/")
        ? "public, max-age=3600"
        : "no-cache",
  };
  const gzipOk = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  if (gzipOk && COMPRESSIBLE.has(ext)) {
    let gz = gzCache.get(file);
    if (!gz) {
      gz = gzipSync(readFileSync(file));
      gzCache.set(file, gz);
    }
    res.writeHead(200, { ...headers, "Content-Encoding": "gzip", Vary: "Accept-Encoding", "Content-Length": String(gz.length) });
    return res.end(gz);
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const t0 = performance.now();
  const url = (req.url ?? "/").split("?")[0];
  if (!url.startsWith("/api/")) return serveStatic(req, res);

  let status = 500;
  let log: Record<string, unknown> = {};
  try {
    const body = req.method === "POST" ? await readJson(req) : undefined;
    const result = await api(req.method ?? "GET", url, body, clientId(req));
    status = result.status;
    log = result.log ?? {};
    send(res, result.status, result.body, result.headers);
  } catch (e) {
    status = (e as { status?: number }).status ?? 500;
    const message = status === 413 ? "Request too large." : status === 400 ? "Invalid JSON." : "Something went wrong.";
    if (status === 500) console.error(e);
    send(res, status, { error: { code: status === 500 ? "internal" : "invalid_request", message } });
  } finally {
    // One structured line per API call. Never logs request text (briefs can be sensitive).
    console.log(JSON.stringify({ at: new Date().toISOString(), route: url, status, ms: Math.round(performance.now() - t0), ...log }));
  }
});

server.listen(PORT, () => {
  console.log(`Catchment server on :${PORT} · AI ${key ? `on (${MODEL})` : "off (no OPENAI_API_KEY)"}`);
});
