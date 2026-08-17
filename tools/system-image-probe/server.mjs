/**
 * Local server for the system-image probe dashboard.
 * Port 8765 — run via npm run probe-dashboard or Probe-Dashboard.cmd
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  readFile,
  writeFile,
  mkdir,
  access,
  unlink,
} from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  SOURCE_KEYS,
  probeHost,
  imagingHosts,
  slugFromName,
  attributionOk,
  sourceResultToCell,
  fetchBuffer,
} from "../../scripts/system-image-sources.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const CATALOG = join(ROOT, "data", "exoplanets.json");
const RESULTS = join(__dirname, "results.json");
const WIKI_CACHE = join(__dirname, "wiki-table.json");
const THUMBS_DIR = join(__dirname, "thumbs");
const RESIZE_PY = join(ROOT, "scripts", "resize-square.py");
const PORT = Number(process.env.PROBE_PORT) || 8765;

let probing = false;
let probeProgress = { running: false, current: 0, total: 0, name: "" };

async function readResults() {
  try {
    return JSON.parse(await readFile(RESULTS, "utf8"));
  } catch {
    return { updatedAt: null, catalogFetchedAt: null, hosts: {} };
  }
}

async function writeResults(data) {
  data.updatedAt = new Date().toISOString();
  await writeFile(RESULTS, JSON.stringify(data, null, 2) + "\n");
}

function resizeSquare(src, dest, size) {
  return new Promise((resolve, reject) => {
    const child = spawn("python", [RESIZE_PY, src, dest, String(size)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err || `resize exited ${code}`));
    });
  });
}

async function buildHostRecord(name, probeResult) {
  const slug = slugFromName(name);
  const sources = {};
  for (const key of SOURCE_KEYS) {
    sources[key] = sourceResultToCell(probeResult.sources[key]);
  }
  const winner = probeResult.winner && !probeResult.winner.error
    ? {
        source: probeResult.winner.source,
        title: probeResult.winner.title,
        credit: probeResult.winner.credit,
        license: probeResult.winner.license,
        sourceUrl: probeResult.winner.sourceUrl,
        score: probeResult.winner.score,
        downloadUrl: probeResult.winner.downloadUrl,
      }
    : null;
  const record = {
    checkedAt: new Date().toISOString(),
    sources,
    winner,
    attributionOk: winner ? attributionOk(probeResult.winner) : false,
    thumb: null,
  };
  if (winner?.downloadUrl) {
    await mkdir(THUMBS_DIR, { recursive: true });
    const thumbRel = `thumbs/${slug}.jpg`;
    const thumbPath = join(__dirname, thumbRel);
    const tmp = join(tmpdir(), `pv-probe-${slug}.bin`);
    try {
      const buf = await fetchBuffer(winner.downloadUrl);
      await writeFile(tmp, buf);
      await resizeSquare(tmp, thumbPath, 64);
      await unlink(tmp).catch(() => {});
      record.thumb = thumbRel;
    } catch (err) {
      record.thumbError = err.message;
    }
  }
  return record;
}

async function probeOneHost(name) {
  const probeResult = await probeHost(name, { wikiCachePath: WIKI_CACHE });
  const record = await buildHostRecord(name, probeResult);
  const results = await readResults();
  results.hosts[name] = record;
  await writeResults(results);
  return record;
}

async function probeAllHosts(hosts) {
  probing = true;
  probeProgress = { running: true, current: 0, total: hosts.length, name: "" };
  const catalog = JSON.parse(await readFile(CATALOG, "utf8"));
  const results = await readResults();
  results.catalogFetchedAt = catalog.fetchedAt || null;
  await writeResults(results);
  for (let i = 0; i < hosts.length; i++) {
    const name = hosts[i];
    probeProgress = { running: true, current: i + 1, total: hosts.length, name };
    try {
      await probeOneHost(name);
    } catch (err) {
      const resultsErr = await readResults();
      resultsErr.hosts[name] = {
        checkedAt: new Date().toISOString(),
        sources: Object.fromEntries(SOURCE_KEYS.map((k) => [k, { ok: false, error: err.message }])),
        winner: null,
        attributionOk: false,
        error: err.message,
      };
      await writeResults(resultsErr);
    }
  }
  probing = false;
  probeProgress = { running: false, current: hosts.length, total: hosts.length, name: "" };
}

function jsonResponse(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

async function serveFile(res, path, contentType) {
  try {
    const body = await readFile(path);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".json": "application/json",
};

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === "GET" && pathname === "/api/state") {
    const catalog = JSON.parse(await readFile(CATALOG, "utf8"));
    const hosts = imagingHosts(catalog);
    const results = await readResults();
    return jsonResponse(res, 200, {
      hosts,
      results,
      probing,
      progress: probeProgress,
      sourceKeys: SOURCE_KEYS,
    });
  }

  if (req.method === "POST" && pathname === "/api/probe/all") {
    if (probing) return jsonResponse(res, 409, { error: "Probe already running" });
    const catalog = JSON.parse(await readFile(CATALOG, "utf8"));
    const hosts = imagingHosts(catalog);
    probeAllHosts(hosts).catch((err) => {
      console.error(err);
      probing = false;
      probeProgress.running = false;
    });
    return jsonResponse(res, 202, { started: true, total: hosts.length });
  }

  if (req.method === "POST" && pathname.startsWith("/api/probe/")) {
    const name = pathname.slice("/api/probe/".length);
    if (!name) return jsonResponse(res, 400, { error: "Missing host name" });
    if (probing) return jsonResponse(res, 409, { error: "Full probe running" });
    try {
      const record = await probeOneHost(name);
      return jsonResponse(res, 200, { name, record });
    } catch (err) {
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  if (req.method === "GET" && pathname.startsWith("/thumbs/")) {
    const file = pathname.slice("/thumbs/".length);
    if (!file || file.includes("..")) {
      res.writeHead(400);
      return res.end();
    }
    return serveFile(res, join(THUMBS_DIR, file), "image/jpeg");
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    return serveFile(res, join(__dirname, "index.html"), MIME[".html"]);
  }

  if (req.method === "GET") {
    const ext = extname(pathname);
    if (MIME[ext]) {
      return serveFile(res, join(__dirname, pathname.slice(1)), MIME[ext]);
    }
  }

  res.writeHead(404);
  res.end("Not found");
}

createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(err.message);
    }
  });
}).listen(PORT, () => {
  console.log(`System image probe dashboard: http://localhost:${PORT}/`);
});
