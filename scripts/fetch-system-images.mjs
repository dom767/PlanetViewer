/**
 * Download public telescope photos for directly imaged catalog hosts.
 *
 * Matching is heuristic: ESO press images, ESO news-related frames,
 * Wikimedia Commons (quoted name), then NASA Image Library.
 * Artist concepts / illustrations / star charts are rejected. Some imaging
 * hosts have no press JPEG — those are listed in data/system-images-report.json.
 *
 * Does not scrape paper PDFs or FITS science archives.
 * ESO CC BY 4.0 credit must stay visible in the app caption.
 *
 * Usage:
 *   node scripts/fetch-system-images.mjs
 *   node scripts/fetch-system-images.mjs --dry-run
 *   node scripts/fetch-system-images.mjs --force
 *   node scripts/fetch-system-images.mjs --only "PDS 70"
 *   node scripts/fetch-system-images.mjs --limit 5
 */

import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  access,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import {
  MIN_SCORE,
  pickBest,
  searchTerms,
  slugFromName,
  imagingHosts,
  fetchBuffer,
} from "./system-image-sources.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CATALOG = join(ROOT, "data", "exoplanets.json");
const OUT_JSON = join(ROOT, "data", "system-images.json");
const OUT_REPORT = join(ROOT, "data", "system-images-report.json");
const OUT_DIR = join(ROOT, "images", "systems");
const RESIZE_PY = join(__dirname, "resize-square.py");
const SIZE = 300;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");
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

async function main() {
  const raw = JSON.parse(await readFile(CATALOG, "utf8"));
  let hosts = imagingHosts(raw);
  if (only) hosts = hosts.filter((n) => n === only);
  hosts = hosts.slice(0, Number.isFinite(limit) ? limit : hosts.length);

  console.log(`Imaging hosts: ${hosts.length}${dryRun ? " (dry-run)" : ""}`);
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(join(ROOT, "data"), { recursive: true });

  /** @type {Record<string, object>} */
  let existing = {};
  try {
    const prev = JSON.parse(await readFile(OUT_JSON, "utf8"));
    existing = prev.images || {};
  } catch {
    existing = {};
  }

  /** @type {Record<string, object>} */
  const images = force ? {} : { ...existing };
  const report = { fetchedAt: new Date().toISOString(), matched: [], skipped: [], noMatch: [], errors: [] };

  for (const name of hosts) {
    const slug = slugFromName(name);
    const dest = join(OUT_DIR, `${slug}.jpg`);
    const rel = `images/systems/${slug}.jpg`;
    const aliases = searchTerms(name);

    if (!force && images[name] && (await fileExists(dest))) {
      console.log(`skip (exists) ${name}`);
      report.skipped.push({ name, reason: "exists" });
      continue;
    }

    console.log(`search ${name}`);
    let hit = null;
    try {
      hit = await pickBest(name, aliases);
    } catch (err) {
      console.warn(`  error: ${err.message}`);
      report.errors.push({ name, error: err.message });
      continue;
    }

    if (!hit || hit.score < MIN_SCORE) {
      console.log(`  no match`);
      report.noMatch.push({ name, best: hit ? { title: hit.title, score: hit.score } : null });
      continue;
    }

    console.log(`  ${hit.source}: ${hit.title} (score ${hit.score})`);
    const meta = {
      src: rel,
      alt: hit.alt || hit.title,
      credit: hit.credit,
      sourceUrl: hit.sourceUrl,
      license: hit.license,
    };

    if (dryRun) {
      report.matched.push({ name, ...meta, dryRun: true, downloadUrl: hit.downloadUrl });
      continue;
    }

    const tmp = join(tmpdir(), `pv-sysimg-${slug}.bin`);
    try {
      const buf = await fetchBuffer(hit.downloadUrl);
      await writeFile(tmp, buf);
      await resizeSquare(tmp, dest);
      await unlink(tmp).catch(() => {});
      images[name] = meta;
      report.matched.push({ name, source: hit.source, title: hit.title, score: hit.score });
    } catch (err) {
      console.warn(`  download/resize failed: ${err.message}`);
      report.errors.push({ name, error: err.message });
      await unlink(tmp).catch(() => {});
    }
  }

  if (!dryRun) {
    const payload = {
      fetchedAt: new Date().toISOString(),
      images,
    };
    await writeFile(OUT_JSON, JSON.stringify(payload, null, 2) + "\n");
    console.log(`Wrote ${OUT_JSON} (${Object.keys(images).length} systems)`);
  }
  await writeFile(OUT_REPORT, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `Report: matched ${report.matched.length}, skipped ${report.skipped.length}, no match ${report.noMatch.length}, errors ${report.errors.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
