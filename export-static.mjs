/**
 * PlanetViewer static export packager.
 *
 * Always refreshes catalog snapshots, then writes Export/VersionN/ with
 * bundled JS/CSS + gzipped data + rewritten index.html.
 *
 * Usage:
 *   node export-static.mjs
 *   node export-static.mjs --skip-fetch   # emergency offline only
 */

import { spawn } from "node:child_process";
import {
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const EXPORT_ROOT = join(ROOT, "Export");
const skipFetch = process.argv.includes("--skip-fetch");

async function nextVersionDir() {
  await mkdir(EXPORT_ROOT, { recursive: true });
  const entries = await readdir(EXPORT_ROOT, { withFileTypes: true });
  let max = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = /^Version(\d+)$/.exec(e.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const n = max + 1;
  const dir = join(EXPORT_ROOT, `Version${n}`);
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "data"), { recursive: true });
  return { n, dir };
}

function runNode(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: ROOT,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${scriptPath} exited with code ${code}`));
    });
  });
}

async function refreshCatalog() {
  if (skipFetch) {
    console.warn("Skipping data refresh (--skip-fetch). Using existing data/ snapshots.");
    return;
  }
  console.log("Refreshing exoplanet catalog from NASA Exoplanet Archive…");
  await runNode(join(ROOT, "scripts", "fetch-exoplanets.mjs"));
  console.log("Refreshing nearby stars from Gaia DR3…");
  await runNode(join(ROOT, "scripts", "fetch-nearby-stars.mjs"));
}

/** Write source JSON as max-level gzip for production fetch + DecompressionStream. */
async function writeGzippedJson(srcPath, destGzPath) {
  const raw = await readFile(srcPath);
  const gz = gzipSync(raw, { level: 9 });
  await writeFile(destGzPath, gz);
  const name = basename(destGzPath);
  console.log(
    `  ${name}: ${(raw.length / 1024).toFixed(0)} KB → ${(gz.length / 1024).toFixed(0)} KB gzip`
  );
}

async function build(outDir, version) {
  const jsOut = join(outDir, "app.bundle.min.js");
  const cssOut = join(outDir, "app.bundle.min.css");

  console.log("Bundling js/main.js…");
  await esbuild.build({
    entryPoints: [join(ROOT, "js", "main.js")],
    bundle: true,
    format: "esm",
    outfile: jsOut,
    minify: true,
    sourcemap: false,
    logLevel: "info",
  });

  console.log("Minifying css/app.css…");
  const cssSource = await readFile(join(ROOT, "css", "app.css"), "utf8");
  const cssResult = await esbuild.transform(cssSource, {
    loader: "css",
    minify: true,
  });
  await writeFile(cssOut, cssResult.code);

  console.log("Compressing catalog data (gzip)…");
  await writeGzippedJson(
    join(ROOT, "data", "exoplanets.json"),
    join(outDir, "data", "exoplanets.json.gz")
  );
  await writeGzippedJson(
    join(ROOT, "data", "nearby-stars.json"),
    join(outDir, "data", "nearby-stars.json.gz")
  );

  console.log("Writing index.html…");
  let html = await readFile(join(ROOT, "index.html"), "utf8");
  html = html.replace(
    /<link rel="stylesheet" href="css\/app\.css"\s*\/>/,
    `<link rel="stylesheet" href="app.bundle.min.css?v=${version}" />`
  );
  html = html.replace(
    /<script type="module" src="js\/main\.js"><\/script>/,
    `<script>self.__PLANETVIEWER_ASSET_VERSION__=${JSON.stringify(String(version))};</script>\n  <script type="module" src="app.bundle.min.js?v=${version}"></script>`
  );
  await writeFile(join(outDir, "index.html"), html);
}

async function main() {
  await refreshCatalog();
  const { n, dir } = await nextVersionDir();
  console.log(`Exporting to Export/Version${n}/`);
  await build(dir, n);
  console.log(`Done → ${dir}`);
  console.log(`Smoke-test: npx --yes serve "Export/Version${n}" -p 8080`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
