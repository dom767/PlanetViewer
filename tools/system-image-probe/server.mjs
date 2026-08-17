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
  copyFile,
  unlink,
} from "node:fs/promises";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  SOURCE_KEYS,
  MIN_SCORE,
  probeHost,
  imagingHosts,
  imagingHostEntries,
  slugFromName,
  attributionOk,
  sourceResultToCell,
  fetchBuffer,
} from "../../scripts/system-image-sources.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const CATALOG = join(ROOT, "data", "exoplanets.json");
const SYSTEM_IMAGES_JSON = join(ROOT, "data", "system-images.json");
const SYSTEM_IMAGES_DIR = join(ROOT, "images", "systems");
const RESULTS = join(__dirname, "results.json");
const WIKI_CACHE = join(__dirname, "wiki-table.json");
const THUMBS_DIR = join(__dirname, "thumbs");
const PREVIEWS_DIR = join(__dirname, "previews");
const RESIZE_PY = join(ROOT, "scripts", "resize-square.py");
const PORT = Number(process.env.PROBE_PORT) || 8765;
const PREVIEW_SIZE = 300;
const THUMB_SIZE = 64;

const SOURCE_LABELS = {
  esoTitle: "ESO title",
  esoNews: "ESO news",
  commons: "Commons",
  nasa: "NASA",
  wikiList: "Wikipedia",
  oec: "OEC",
};

let probing = false;
let probeCancelRequested = false;
let probeProgress = {
  running: false,
  mode: null,
  hostIndex: 0,
  hostTotal: 0,
  name: "",
  phase: "idle",
  sourceKey: null,
  sourceIndex: 0,
  sourceTotal: SOURCE_KEYS.length,
  liveSources: {},
  log: [],
  cancelled: false,
};

function sourceLabel(key) {
  return SOURCE_LABELS[key] || key;
}

function logProgress(message) {
  probeProgress.log.unshift({ at: new Date().toISOString(), message });
  if (probeProgress.log.length > 100) probeProgress.log.length = 100;
}

function resetProbeProgress(mode, hostTotal) {
  probeProgress = {
    running: true,
    mode,
    hostIndex: 0,
    hostTotal,
    name: "",
    phase: "idle",
    sourceKey: null,
    sourceIndex: 0,
    sourceTotal: SOURCE_KEYS.length,
    liveSources: {},
    log: [],
    cancelled: false,
  };
}

function formatSourceResult(name, sourceKey, hit) {
  const cell = sourceResultToCell(hit);
  const label = sourceLabel(sourceKey);
  if (cell.ok) {
    const title = cell.title ? `: ${cell.title.slice(0, 72)}` : "";
    return `${name} · ${label} ✓${title} (score ${cell.score})`;
  }
  if (cell.error) return `${name} · ${label} ✗ ${cell.error}`;
  if (cell.title) return `${name} · ${label} ✗ below threshold (score ${cell.score})`;
  return `${name} · ${label} ✗ no match`;
}

function handleProbeProgress(ev) {
  if (ev.phase === "wiki-table") {
    probeProgress.phase = "wiki-table";
    if (ev.status === "loading") logProgress("Loading Wikipedia exoplanet table…");
    else logProgress("Wikipedia table ready");
    return;
  }
  if (ev.phase === "source-start") {
    probeProgress.phase = "source";
    probeProgress.sourceKey = ev.sourceKey;
    probeProgress.sourceIndex = ev.sourceIndex;
    probeProgress.sourceTotal = ev.sourceTotal;
    logProgress(`${ev.name}: querying ${sourceLabel(ev.sourceKey)}…`);
    return;
  }
  if (ev.phase === "source-done") {
    probeProgress.liveSources[ev.sourceKey] = sourceResultToCell(ev.hit);
    logProgress(formatSourceResult(ev.name, ev.sourceKey, ev.hit));
    return;
  }
  if (ev.phase === "host-probe-done") {
    probeProgress.phase = "assets";
  }
}

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

async function buildSourceAssets(slug, sourceKey, hit) {
  if (!hit?.downloadUrl) return null;
  const thumbDir = join(THUMBS_DIR, slug);
  const previewDir = join(PREVIEWS_DIR, slug);
  await mkdir(thumbDir, { recursive: true });
  await mkdir(previewDir, { recursive: true });
  const thumbRel = `thumbs/${slug}/${sourceKey}.jpg`;
  const previewRel = `previews/${slug}/${sourceKey}.jpg`;
  const thumbPath = join(__dirname, thumbRel);
  const previewPath = join(__dirname, previewRel);
  const tmp = join(tmpdir(), `pv-probe-${slug}-${sourceKey}.bin`);
  try {
    const buf = await fetchBuffer(hit.downloadUrl);
    await writeFile(tmp, buf);
    await resizeSquare(tmp, thumbPath, THUMB_SIZE);
    await resizeSquare(tmp, previewPath, PREVIEW_SIZE);
    await unlink(tmp).catch(() => {});
    return { thumb: thumbRel, preview: previewRel };
  } catch (err) {
    return { error: err.message };
  }
}

function winnerFromProbe(probeResult) {
  const w = probeResult.winner;
  if (!w || w.error) return null;
  return {
    source: w.source,
    sourceKey: findWinnerKey(probeResult.sources, w),
    title: w.title,
    credit: w.credit,
    license: w.license,
    sourceUrl: w.sourceUrl,
    score: w.score,
    downloadUrl: w.downloadUrl,
  };
}

function findWinnerKey(rawSources, winner) {
  if (!winner) return null;
  for (const key of SOURCE_KEYS) {
    const hit = rawSources[key];
    if (hit && !hit.error && hit.score >= MIN_SCORE && hit.downloadUrl === winner.downloadUrl) {
      return key;
    }
  }
  for (const key of SOURCE_KEYS) {
    const hit = rawSources[key];
    if (hit && !hit.error && hit.score >= MIN_SCORE && hit.title === winner.title) {
      return key;
    }
  }
  return null;
}

function cellAttributionOk(cell, sourceKey) {
  if (!cell?.ok) return false;
  return attributionOk({ ...cell, source: sourceKey });
}

function applySelectionToRecord(record) {
  const key = record.selectedSource;
  const cell = key ? record.sources[key] : null;
  record.attributionOk = cell ? cellAttributionOk(cell, key) : false;
  record.thumb = cell?.thumb || null;
  record.preview = cell?.preview || null;
  return record;
}

async function applySelectionToApp(name, cell, sourceKey) {
  if (!cell?.preview) throw new Error("No preview for selected source");
  const slug = slugFromName(name);
  const previewPath = join(__dirname, cell.preview);
  const dest = join(SYSTEM_IMAGES_DIR, `${slug}.jpg`);
  await mkdir(SYSTEM_IMAGES_DIR, { recursive: true });
  await copyFile(previewPath, dest);

  let payload = { fetchedAt: new Date().toISOString(), images: {} };
  try {
    payload = JSON.parse(await readFile(SYSTEM_IMAGES_JSON, "utf8"));
    if (!payload.images) payload.images = {};
  } catch {
    payload.images = {};
  }
  payload.fetchedAt = new Date().toISOString();
  payload.images[name] = {
    src: `images/systems/${slug}.jpg`,
    alt: cell.title,
    credit: cell.credit,
    sourceUrl: cell.sourceUrl,
    license: cell.license,
  };
  await writeFile(SYSTEM_IMAGES_JSON, JSON.stringify(payload, null, 2) + "\n");
}

async function buildHostRecord(name, probeResult, previousRecord = null, options = {}) {
  const { onAssetProgress } = options;
  const slug = slugFromName(name);
  const sources = {};
  for (const key of SOURCE_KEYS) {
    const cell = sourceResultToCell(probeResult.sources[key]);
    if (cell.ok) {
      onAssetProgress?.(key, "start");
      const assets = await buildSourceAssets(slug, key, probeResult.sources[key]);
      if (assets?.thumb) {
        cell.thumb = assets.thumb;
        cell.preview = assets.preview;
        onAssetProgress?.(key, "done");
      } else if (assets?.error) {
        cell.assetError = assets.error;
        onAssetProgress?.(key, "error");
      }
    }
    sources[key] = cell;
  }

  const winner = winnerFromProbe(probeResult);
  let selectedSource = previousRecord?.selectedSource ?? null;
  if (!selectedSource || !sources[selectedSource]?.ok) {
    selectedSource = winner?.sourceKey || null;
  }

  const record = applySelectionToRecord({
    checkedAt: new Date().toISOString(),
    sources,
    winner,
    selectedSource,
  });

  if (record.selectedSource && record.sources[record.selectedSource]?.preview) {
    try {
      await applySelectionToApp(name, record.sources[record.selectedSource], record.selectedSource);
    } catch (err) {
      record.applyError = err.message;
    }
  }

  return record;
}

async function readCatalog() {
  return JSON.parse(await readFile(CATALOG, "utf8"));
}

function planetNamesForHost(catalog, name) {
  const entry = imagingHostEntries(catalog).find((e) => e.name === name);
  return entry?.planetNames || [];
}

async function probeOneHost(name, { hostIndex = 1, hostTotal = 1 } = {}) {
  probeProgress.hostIndex = hostIndex;
  probeProgress.hostTotal = hostTotal;
  probeProgress.name = name;
  probeProgress.liveSources = {};
  probeProgress.phase = "source";
  logProgress(`—— ${name} (${hostIndex}/${hostTotal}) ——`);

  const catalog = await readCatalog();
  const planetNames = planetNamesForHost(catalog, name);
  const results = await readResults();
  const previous = results.hosts[name];
  const probeResult = await probeHost(name, {
    wikiCachePath: WIKI_CACHE,
    onProgress: handleProbeProgress,
    planetNames,
  });
  const record = await buildHostRecord(name, probeResult, previous, {
    onAssetProgress(key, status) {
      if (status === "start") {
        probeProgress.phase = "assets";
        probeProgress.sourceKey = key;
        logProgress(`${name}: downloading ${sourceLabel(key)} preview…`);
      } else if (status === "done") {
        logProgress(`${name}: ${sourceLabel(key)} preview ready`);
      } else if (status === "error") {
        logProgress(`${name}: ${sourceLabel(key)} preview failed`);
      }
    },
  });
  results.hosts[name] = record;
  await writeResults(results);
  probeProgress.phase = "host-done";
  const pick = record.selectedSource ? sourceLabel(record.selectedSource) : "none";
  logProgress(`${name}: finished (selected: ${pick})`);
  return record;
}

async function selectHostSource(name, sourceKey) {
  if (!SOURCE_KEYS.includes(sourceKey)) {
    throw new Error(`Unknown source: ${sourceKey}`);
  }
  const results = await readResults();
  const row = results.hosts[name];
  if (!row) throw new Error("Host not probed yet");
  const cell = row.sources[sourceKey];
  if (!cell?.ok) throw new Error("Source has no usable image");
  row.selectedSource = sourceKey;
  applySelectionToRecord(row);
  await applySelectionToApp(name, cell, sourceKey);
  results.hosts[name] = row;
  await writeResults(results);
  return row;
}

async function probeAllHosts(hosts) {
  probing = true;
  probeCancelRequested = false;
  resetProbeProgress("all", hosts.length);
  logProgress(`Starting check-all for ${hosts.length} hosts`);
  const catalog = JSON.parse(await readFile(CATALOG, "utf8"));
  const results = await readResults();
  results.catalogFetchedAt = catalog.fetchedAt || null;
  await writeResults(results);
  for (let i = 0; i < hosts.length; i++) {
    if (probeCancelRequested) break;
    const name = hosts[i];
    try {
      await probeOneHost(name, { hostIndex: i + 1, hostTotal: hosts.length });
    } catch (err) {
      logProgress(`${name}: error — ${err.message}`);
      const resultsErr = await readResults();
      resultsErr.hosts[name] = {
        checkedAt: new Date().toISOString(),
        sources: Object.fromEntries(SOURCE_KEYS.map((k) => [k, { ok: false, error: err.message }])),
        winner: null,
        selectedSource: null,
        attributionOk: false,
        error: err.message,
      };
      await writeResults(resultsErr);
    }
  }
  const cancelled = probeCancelRequested;
  probing = false;
  probeCancelRequested = false;
  if (cancelled) logProgress(`Stopped after ${probeProgress.hostIndex} / ${hosts.length} hosts`);
  else logProgress(`Check-all complete (${hosts.length} hosts)`);
  probeProgress.running = false;
  probeProgress.phase = cancelled ? "cancelled" : "idle";
  probeProgress.cancelled = cancelled;
}

function jsonResponse(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
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

  if (req.method === "POST" && pathname === "/api/probe/stop") {
    if (!probing) return jsonResponse(res, 200, { stopped: false, message: "No probe running" });
    probeCancelRequested = true;
    return jsonResponse(res, 200, { stopped: true });
  }

  if (req.method === "POST" && pathname === "/api/probe/all") {
    if (probing) return jsonResponse(res, 409, { error: "Probe already running" });
    const catalog = await readCatalog();
    const hosts = imagingHosts(catalog);
    probeAllHosts(hosts).catch((err) => {
      console.error(err);
      probing = false;
      probeProgress.running = false;
    });
    return jsonResponse(res, 202, { started: true, total: hosts.length });
  }

  if (req.method === "POST" && pathname.startsWith("/api/select/")) {
    const name = pathname.slice("/api/select/".length);
    if (!name) return jsonResponse(res, 400, { error: "Missing host name" });
    try {
      const body = await readJsonBody(req);
      const record = await selectHostSource(name, body.source);
      return jsonResponse(res, 200, { name, record });
    } catch (err) {
      return jsonResponse(res, 400, { error: err.message });
    }
  }

  if (req.method === "POST" && pathname.startsWith("/api/probe/")) {
    const name = pathname.slice("/api/probe/".length);
    if (!name) return jsonResponse(res, 400, { error: "Missing host name" });
    if (probing) return jsonResponse(res, 409, { error: "Full probe running" });
    probing = true;
    resetProbeProgress("single", 1);
    try {
      const record = await probeOneHost(name, { hostIndex: 1, hostTotal: 1 });
      probing = false;
      probeProgress.running = false;
      probeProgress.phase = "idle";
      return jsonResponse(res, 200, { name, record });
    } catch (err) {
      probing = false;
      probeProgress.running = false;
      probeProgress.phase = "idle";
      return jsonResponse(res, 500, { error: err.message });
    }
  }

  if (req.method === "GET" && pathname.startsWith("/previews/")) {
    const file = pathname.slice("/previews/".length);
    if (!file || file.includes("..")) {
      res.writeHead(400);
      return res.end();
    }
    return serveFile(res, join(PREVIEWS_DIR, file), "image/jpeg");
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
