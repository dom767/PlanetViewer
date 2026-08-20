/**
 * Local server for the catalog import dashboard.
 * Port 8766 — run via npm run catalog-import or Catalog-Import.cmd
 */

import { createServer } from "node:http";
import { readFile, access } from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  importAll,
  importBinaries,
  importExoplanets,
  importNearbyStars,
} from "../../scripts/catalog-import/run.mjs";
import {
  CLOSE_BINARIES_PATH,
  EXOPLANETS_PATH,
  NEARBY_PATH,
  STATS_PATH,
} from "../../scripts/catalog-import/util.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CATALOG_IMPORT_PORT) || 8766;
export const SERVER_VERSION = "1.0.0";

let running = false;
let progress = blankProgress();

function blankProgress() {
  return {
    running: false,
    job: null,
    phase: "idle",
    log: [],
    error: null,
    cancelled: false,
    result: null,
  };
}

function logProgress(message) {
  progress.log.unshift({ at: new Date().toISOString(), message: String(message) });
  if (progress.log.length > 200) progress.log.length = 200;
}

async function fileMeta(path) {
  try {
    await access(path);
    const data = JSON.parse(await readFile(path, "utf8"));
    return {
      exists: true,
      fetchedAt: data.fetchedAt || data.binaryFetchedAt || null,
      systemCount: data.systemCount ?? data.starCount ?? data.binaryCount ?? null,
      planetCount: data.planetCount ?? null,
      multiplicity: data.multiplicity || null,
    };
  } catch {
    return { exists: false, fetchedAt: null, systemCount: null, planetCount: null };
  }
}

async function readStats() {
  try {
    return JSON.parse(await readFile(STATS_PATH, "utf8"));
  } catch {
    return null;
  }
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

const JOBS = {
  exoplanets: {
    label: "Refresh exoplanets",
    run: () => importExoplanets({ onLog: logProgress }),
  },
  binaries: {
    label: "Refresh binaries",
    run: () => importBinaries({ onLog: logProgress }),
  },
  nearby: {
    label: "Refresh nearby stars",
    run: () => importNearbyStars({ onLog: logProgress }),
  },
  all: {
    label: "Run all",
    run: () => importAll({ onLog: logProgress }),
  },
};

async function startJob(key) {
  const job = JOBS[key];
  if (!job) throw new Error(`Unknown job: ${key}`);
  if (running) throw new Error("A catalog import is already running");
  running = true;
  progress = {
    running: true,
    job: key,
    phase: "running",
    log: [],
    error: null,
    cancelled: false,
    result: null,
  };
  logProgress(`Starting ${job.label}…`);
  try {
    const result = await job.run();
    progress.result = result;
    progress.phase = "idle";
    logProgress(`${job.label} complete`);
    return result;
  } catch (err) {
    progress.error = err.message;
    progress.phase = "error";
    logProgress(`ERROR: ${err.message}`);
    throw err;
  } finally {
    running = false;
    progress.running = false;
  }
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === "GET" && pathname === "/api/state") {
    const [exo, nearby, binaries, stats] = await Promise.all([
      fileMeta(EXOPLANETS_PATH),
      fileMeta(NEARBY_PATH),
      fileMeta(CLOSE_BINARIES_PATH),
      readStats(),
    ]);
    return jsonResponse(res, 200, {
      serverVersion: SERVER_VERSION,
      running,
      progress,
      snapshots: { exoplanets: exo, nearby, binaries },
      stats,
    });
  }

  if (req.method === "POST" && pathname.startsWith("/api/run/")) {
    const key = pathname.slice("/api/run/".length);
    if (!JOBS[key]) return jsonResponse(res, 400, { error: `Unknown job: ${key}` });
    if (running) return jsonResponse(res, 409, { error: "Import already running" });
    startJob(key).catch((err) => console.error(err));
    return jsonResponse(res, 202, { started: true, job: key });
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "/index.html")) {
    return serveFile(res, join(__dirname, "index.html"), "text/html; charset=utf-8");
  }

  const MIME = {
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json",
  };
  if (req.method === "GET") {
    const ext = extname(pathname);
    if (MIME[ext]) return serveFile(res, join(__dirname, pathname.slice(1)), MIME[ext]);
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
  console.log(`Catalog import dashboard v${SERVER_VERSION}: http://localhost:${PORT}/`);
});
