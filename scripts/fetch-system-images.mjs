/**
 * Apply curated probe-dashboard selections into the app catalog.
 *
 * Default: read tools/system-image-probe/results.json, copy each selected
 * 300×300 preview into images/systems/, and write data/system-images.json.
 * Hosts marked “no image” (or never selected) are omitted.
 *
 * --search  live-probe hosts that still have no selection (ESO / Commons /
 *           NASA / Wikipedia list / OEC), then write those hits too
 * --force   recopy even when the JPEG already exists
 * --dry-run report only
 * --only "PDS 70"
 * --limit 5
 */

import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  access,
  copyFile,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  MIN_SCORE,
  pickBestFromHits,
  probeHost,
  slugFromName,
  imagingHostEntries,
  fetchBuffer,
} from "./system-image-sources.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CATALOG = join(ROOT, "data", "exoplanets.json");
const OUT_JSON = join(ROOT, "data", "system-images.json");
const OUT_REPORT = join(ROOT, "data", "system-images-report.json");
const OUT_DIR = join(ROOT, "images", "systems");
const RESULTS = join(ROOT, "tools", "system-image-probe", "results.json");
const PREVIEW_ROOT = join(ROOT, "tools", "system-image-probe");
const WIKI_CACHE = join(PREVIEW_ROOT, "wiki-table.json");
const RESIZE_PY = join(__dirname, "resize-square.py");
const SIZE = 300;
const NO_IMAGE_SOURCE = "none";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");
const liveSearch = args.has("--search");
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
const only = argValue("--only");
const limit = argValue("--limit") ? Number(argValue("--limit")) : Infinity;

function resizeSquare(src, dest) {
  return new Promise((resolve, reject) => {
    const child = spawn("python", [RESIZE_PY, src, dest, String(SIZE)], {
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

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function metaFromCell(name, cell) {
  const slug = slugFromName(name);
  return {
    src: `images/systems/${slug}.jpg`,
    alt: cell.alt || cell.title,
    credit: cell.credit,
    sourceUrl: cell.sourceUrl,
    license: cell.license,
  };
}

async function installJpeg(name, { previewRel, downloadUrl }) {
  const slug = slugFromName(name);
  const dest = join(OUT_DIR, `${slug}.jpg`);
  if (!force && (await fileExists(dest))) return dest;
  if (previewRel) {
    const previewPath = join(PREVIEW_ROOT, previewRel);
    if (await fileExists(previewPath)) {
      if (!dryRun) await copyFile(previewPath, dest);
      return dest;
    }
  }
  if (!downloadUrl) throw new Error("no preview or download URL");
  const tmp = join(tmpdir(), `pv-sysimg-${slug}.bin`);
  const buf = await fetchBuffer(downloadUrl);
  await writeFile(tmp, buf);
  try {
    if (!dryRun) await resizeSquare(tmp, dest);
  } finally {
    await unlink(tmp).catch(() => {});
  }
  return dest;
}

async function loadProbeResults() {
  try {
    return JSON.parse(await readFile(RESULTS, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const raw = JSON.parse(await readFile(CATALOG, "utf8"));
  let entries = imagingHostEntries(raw);
  if (only) entries = entries.filter((e) => e.name === only);
  entries = entries.slice(0, Number.isFinite(limit) ? limit : entries.length);

  console.log(`Imaging hosts: ${entries.length}${dryRun ? " (dry-run)" : ""}`);
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(join(ROOT, "data"), { recursive: true });

  const probe = await loadProbeResults();
  /** @type {Record<string, object>} */
  const images = {};
  const report = {
    fetchedAt: new Date().toISOString(),
    applied: [],
    none: [],
    noSelection: [],
    searched: [],
    skipped: [],
    errors: [],
    removed: [],
  };

  for (const { name, planetNames } of entries) {
    const row = probe?.hosts?.[name];
    const selected = row?.selectedSource;
    if (selected === NO_IMAGE_SOURCE) {
      console.log(`none ${name}`);
      report.none.push({ name });
      continue;
    }
    if (selected && row.sources?.[selected]?.ok) {
      const cell = row.sources[selected];
      try {
        await installJpeg(name, {
          previewRel: cell.preview,
          downloadUrl: cell.downloadUrl,
        });
        images[name] = metaFromCell(name, cell);
        console.log(`apply ${name} ← ${selected}`);
        report.applied.push({ name, source: selected, title: cell.title });
      } catch (err) {
        console.warn(`  apply failed: ${err.message}`);
        report.errors.push({ name, error: err.message });
      }
      continue;
    }

    if (!liveSearch) {
      console.log(`no selection ${name}`);
      report.noSelection.push({ name });
      continue;
    }

    console.log(`search ${name}`);
    let hit = null;
    try {
      const probed = await probeHost(name, { planetNames, wikiCachePath: WIKI_CACHE });
      hit = pickBestFromHits(probed.sources);
    } catch (err) {
      console.warn(`  error: ${err.message}`);
      report.errors.push({ name, error: err.message });
      continue;
    }
    if (!hit || hit.score < MIN_SCORE) {
      console.log(`  no match`);
      report.noSelection.push({ name, best: hit ? { title: hit.title, score: hit.score } : null });
      continue;
    }
    console.log(`  ${hit.source}: ${hit.title} (score ${hit.score})`);
    try {
      await installJpeg(name, { downloadUrl: hit.downloadUrl });
      images[name] = metaFromCell(name, hit);
      report.searched.push({ name, source: hit.source, title: hit.title, score: hit.score });
    } catch (err) {
      console.warn(`  download/resize failed: ${err.message}`);
      report.errors.push({ name, error: err.message });
    }
  }

  const partial = Boolean(only) || Number.isFinite(limit);
  /** @type {Record<string, object>} */
  let payloadImages = images;
  if (partial) {
    try {
      const prev = JSON.parse(await readFile(OUT_JSON, "utf8"));
      payloadImages = { ...(prev.images || {}), ...images };
    } catch {
      payloadImages = images;
    }
    for (const { name } of entries) {
      if (probe?.hosts?.[name]?.selectedSource === NO_IMAGE_SOURCE) {
        delete payloadImages[name];
      }
    }
  }

  if (!partial) {
    const keepFiles = new Set(
      Object.values(payloadImages).map((m) => String(m.src).replace(/^images\/systems\//, ""))
    );
    const existing = await readdir(OUT_DIR).catch(() => []);
    for (const file of existing) {
      if (!file.endsWith(".jpg")) continue;
      if (keepFiles.has(file)) continue;
      console.log(`remove leftover ${file}`);
      report.removed.push(file);
      if (!dryRun) await unlink(join(OUT_DIR, file)).catch(() => {});
    }
  }

  if (!dryRun) {
    const sorted = Object.fromEntries(
      Object.keys(payloadImages)
        .sort((a, b) => a.localeCompare(b))
        .map((k) => [k, payloadImages[k]])
    );
    await writeFile(
      OUT_JSON,
      JSON.stringify({ fetchedAt: new Date().toISOString(), images: sorted }, null, 2) + "\n"
    );
    console.log(`Wrote ${OUT_JSON} (${Object.keys(sorted).length} systems)`);
  }
  await writeFile(OUT_REPORT, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `Report: applied ${report.applied.length}, none ${report.none.length}, no selection ${report.noSelection.length}, searched ${report.searched.length}, removed ${report.removed.length}, errors ${report.errors.length}`
  );
  if (!probe) {
    console.log("No probe results.json found — ran without dashboard selections.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
