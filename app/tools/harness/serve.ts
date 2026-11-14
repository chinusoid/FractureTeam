/**
 * Test harness: runs the same client UI without Next.js (esbuild bundle + tiny node server).
 * /api/assistant and /api/health are served by the real handlers from src/lib/ai when they exist,
 * with AI_MOCK=1 and QUOTA_MODE=memory, so no network or keys are needed.
 *
 *   tsx tools/harness/serve.ts            -> http://127.0.0.1:4317
 */
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, "../..");
const outDir = path.join(os.tmpdir(), "covered-harness");

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Covered (harness)</title>
<link rel="stylesheet" href="/harness.css" />
</head>
<body>
<div id="root"></div>
<script type="module" src="/harness.js"></script>
</body>
</html>`;

export async function buildBundle(): Promise<void> {
  await build({
    entryPoints: { harness: path.join(here, "entry.tsx") },
    bundle: true,
    outdir: outDir,
    format: "esm",
    platform: "browser",
    target: "es2020",
    jsx: "automatic",
    sourcemap: "inline",
    define: { "process.env.NODE_ENV": '"development"' },
    nodePaths: [path.join(appRoot, "node_modules")],
    logLevel: "error",
  });
}

type Handler = (req: Request) => Promise<Response>;

async function loadHandler(file: string, exportName: string): Promise<Handler | null> {
  const full = path.join(appRoot, "src/lib/ai", file);
  if (!existsSync(full)) return null;
  try {
    const mod = (await import(pathToFileURL(full).href)) as Record<string, unknown>;
    const fn = mod[exportName];
    return typeof fn === "function" ? (fn as Handler) : null;
  } catch (e) {
    console.error(`[harness] could not load ${file}:`, e);
    return null;
  }
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function aiDisabled(res: http.ServerResponse) {
  res.writeHead(503, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: "ai_disabled", message: "AI handler is not available in this harness." } }));
}

export async function startHarness(port = 0): Promise<{ url: string; close: () => Promise<void> }> {
  process.env.AI_MOCK ??= "1";
  process.env.QUOTA_MODE ??= "memory";
  await buildBundle();
  const assistant = await loadHandler("handler.ts", "handleAssistant");
  const health = await loadHandler("health.ts", "handleHealth");
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
      if (url.pathname === "/harness.js" || url.pathname === "/harness.css") {
        const file = path.join(outDir, url.pathname.slice(1));
        res.writeHead(200, { "content-type": url.pathname.endsWith(".js") ? "text/javascript" : "text/css", "cache-control": "no-store" });
        res.end(readFileSync(file));
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        const handler = url.pathname === "/api/assistant" ? assistant : url.pathname === "/api/health" ? health : null;
        if (!handler) return aiDisabled(res);
        const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
          else if (v !== undefined) headers.set(k, v);
        }
        const request = new Request(url.href, { method: req.method, headers, body: body ? new Uint8Array(body) : undefined });
        const response = await handler(request);
        const out: Record<string, string> = {};
        response.headers.forEach((v, k) => (out[k] = v));
        res.writeHead(response.status, out);
        res.end(Buffer.from(await response.arrayBuffer()));
        return;
      }
      if (url.pathname === "/favicon.ico") {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(HTML);
    } catch (e) {
      console.error("[harness]", e);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("harness error");
    }
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 4317);
  startHarness(port).then(({ url }) => console.log(`Harness running at ${url}`));
}
