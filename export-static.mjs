/**
 * PlanetViewer static export packager.
 *
 * Packages existing data/ snapshots into Export/VersionN/ with bundled JS/CSS,
 * gzipped catalogs, and rewritten index.html.
 *
 * Catalog refresh is intentional and separate:
 *   npm run fetch-data
 *   Fetch-Data.cmd
 *
 * Usage:
 *   node export-static.mjs
 */

import {
  access,
  cp,
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
const EXOPLANETS = join(ROOT, "data", "exoplanets.json");
const NEARBY = join(ROOT, "data", "nearby-stars.json");
const SYSTEM_IMAGES = join(ROOT, "data", "system-images.json");

async function requireSnapshot(path) {
  try {
    await access(path);
  } catch {
    throw new Error(
      `Missing ${basename(path)}. Run catalog import first:\n` +
        `  npm run fetch-data\n` +
        `  or Fetch-Data.cmd`
    );
  }
}

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
  await writeGzippedJson(EXOPLANETS, join(outDir, "data", "exoplanets.json.gz"));
  await writeGzippedJson(NEARBY, join(outDir, "data", "nearby-stars.json.gz"));
  await writeGzippedJson(SYSTEM_IMAGES, join(outDir, "data", "system-images.json.gz"));

  console.log("Copying system images…");
  await cp(join(ROOT, "images", "systems"), join(outDir, "images", "systems"), {
    recursive: true,
  });

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
  await requireSnapshot(EXOPLANETS);
  await requireSnapshot(NEARBY);
  await requireSnapshot(SYSTEM_IMAGES);

  const { n, dir } = await nextVersionDir();
  console.log(`Using existing data/ snapshots (run npm run fetch-data to refresh).`);
  console.log(`Exporting to Export/Version${n}/`);
  await build(dir, n);
  console.log(`Done → ${dir}`);
  console.log(`Smoke-test: npx --yes serve "Export/Version${n}" -p 8080`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
