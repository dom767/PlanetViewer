# Static export and deploy pattern (PlanetViewer)

This document describes packaging and hosting for **PlanetViewer**: a browser WebGPU app that ships as static files (HTML, CSS, JS, and the exoplanet catalog JSON). The goal is a repeatable local export that produces a clean, versioned distribution folder, then optionally uploads it to object storage.

PlanetViewer is simpler than apps like Vulcan (no Web Worker, no large panorama packages, no editor), but it is still an **ES-module** graph — do not concatenate scripts as globals. Keep the shared Highpersonic/Vulcan versioning + S3 stages; use a small module bundler for `js/`.

Use this as the blueprint for implementing `export-static` tooling in this repo.

## Goals

- Produce a self-contained static build that can be hosted without `Start.cmd` / `python -m http.server` / `npm start`.
- Keep every export in an incrementing version folder so previous builds remain available for comparison or rollback.
- Reduce HTTP requests by bundling the `js/**` module graph (and optionally minifying CSS).
- Ship gzipped catalog snapshots (`data/*.json.gz`) with the build.
- Exclude development-only files (local server helpers, fetch scripts, docs, packaging sources).
- Upload with cache headers that favour long-lived versioned assets (`?v=N`) and a short-lived HTML entry.
- Preserve runtime behaviour: WebGPU star map, Sol ephemeris, minimap, focus/orbit camera, Goldilocks colours.

## App shape (what we are packaging)

Development loads:

```html
<link rel="stylesheet" href="css/app.css" />
<script type="module" src="js/main.js"></script>
```

Runtime also `fetch`es page-relative:

```text
data/exoplanets.json          # local / authoring
data/nearby-stars.json
```

Production exports ship **gzipped** copies only:

```text
data/exoplanets.json.gz
data/nearby-stars.json.gz
```

The loader decompresses with `DecompressionStream` when `__PLANETVIEWER_ASSET_VERSION__` is set.

There is **no** service worker, **no** Web Worker, and **no** Node runtime in production. WebGPU requires a **secure context** (HTTPS or `localhost`).

## Layout

```text
PlanetViewer/
  index.html                 # source entry page
  css/app.css
  js/                        # ES module graph (main.js entry)
  data/exoplanets.json       # NASA PSCompPars snapshot (~2 MB)
  data/nearby-stars.json     # Gaia DR3 within 30 pc (~optional toggle)
  scripts/fetch-exoplanets.mjs
  scripts/fetch-nearby-stars.mjs
  Start.cmd / Stop.cmd       # local static server helpers
  package.json
  export-static.*            # packaging entrypoints (to be added)
  Export/                    # generated; gitignored
    Version1/
    Version2/
    VersionN/                # latest successful export
```

Conventions:

| Item | Convention |
| --- | --- |
| Export root | `Export/` at the project root |
| Version folders | `Version1`, `Version2`, … (no zero-padding) |
| Next version | Highest existing `VersionN` + 1; if none exist, start at `1` |
| Git | Ignore `Export/` so builds stay local unless you choose otherwise |

Each `VersionN` folder is a complete snapshot of what should be published. Do not mutate an old version in place; always create the next number.

## Pipeline overview

```text
Source tree
    │
    ▼
1. Choose next VersionN under Export/
    │
    ▼
2. Refresh catalogs (NASA TAP + Gaia; abort on failure)
    │
    ▼
3. Bundle js/main.js → app.bundle.min.js (esbuild/Rollup)
    │
    ▼
4. Copy / minify css/app.css → app.bundle.min.css (or copy as-is)
    │
    ▼
5. Rewrite index.html to production assets + ?v=N
    │
    ▼
6. Gzip refreshed data/*.json → data/*.json.gz in the export
    │
    ▼
7. Prune anything not needed at runtime
    │
    ▼
8. (Optional) Upload latest VersionN to hosting
```

## Running an export (target UX)

### Prerequisites

- **Node.js** — packaging driver (`type: "module"` already in `package.json`).
- **Bundler** — esbuild via `npx` or a `devDependency`. Fail hard if the app bundle cannot be produced.
- **AWS CLI v2** (only if uploading) — authenticated for the target bucket. Wrapper should check credentials before upload; on failure run `aws login` (browser) and retry.

### Commands (intended)

```powershell
# Full export + upload (defaults: bucket/prefix configured in the wrapper)
.\Export-Static.cmd

# Export only (no upload)
.\Export-Static.ps1 -SkipUpload

# Export + upload to a custom location
.\Export-Static.ps1 -S3Bucket "example.com" -S3Prefix "planetviewer/"
```

Or call the packager directly:

```powershell
node export-static.mjs
# after wiring package.json:
npm run export-static
```

The PowerShell wrapper should always run the export first, then (unless `-SkipUpload`) find the newest `Export/VersionN` and sync it to S3.

### Local smoke-test before upload

```powershell
npx --yes serve Export/VersionN -p 8080
# or: python -m http.server 8080  (from inside VersionN)
```

Open `http://localhost:8080` (secure context for WebGPU).

---

## Stage details

### 1. Version selection

Scan `Export/` for directories matching `^Version(\d+)$`. Take the maximum number and add one. Create `Export/VersionN/`.

Useful for diffing releases, re-uploading an older folder, and avoiding clobber of a known-good package.

### 2. Catalog data

| Action | Notes |
| --- | --- |
| **Required on every build** | Run `scripts/fetch-exoplanets.mjs` and `scripts/fetch-nearby-stars.mjs` so both JSON snapshots are fresh |
| Then compress | Gzip each snapshot into `Export/VersionN/data/*.json.gz` (level 9). Do **not** ship the uncompressed JSON in the export |
| Offline escape hatch | `node export-static.mjs --skip-fetch` (or `Export-Static.ps1 -SkipFetch`) only when TAP is unreachable — still requires existing snapshots |

**Build fails if catalog refresh fails** (unless `--skip-fetch`). Do not ship stale catalogs by accident.

Typical sizes after gzip: exoplanets ~370 KB, nearby-stars ~330 KB (vs ~1.9 MB / ~1 MB raw).

### 3–5. Bundle, CSS, rewrite entry

**JavaScript**

- Entry: `js/main.js`
- Format: `esm`
- Output: `Export/VersionN/app.bundle.min.js`
- `bundle: true`, `minify: true` when esbuild is available
- Fail hard if bundling fails

**CSS**

- Single file today: `css/app.css` (no `@import` chain)
- Emit `app.bundle.min.css` (minify if easy) or copy as `app.css`
- No Google Fonts / external stylesheets currently

**HTML rewrite**

Replace:

```html
<link rel="stylesheet" href="css/app.css" />
<script type="module" src="js/main.js"></script>
```

with production references stamped by version `N`:

```html
<link rel="stylesheet" href="app.bundle.min.css?v=N" />
<script type="module" src="app.bundle.min.js?v=N"></script>
```

Also set a global for runtime cache-busting of the catalog fetch, e.g.:

```html
<script>
  self.__PLANETVIEWER_ASSET_VERSION__ = "N";
</script>
```

Ensure `js/data/loader.js` (once bundled) appends `?v=N` and, in production, fetches **gzipped** catalogs:

```js
const v = self.__PLANETVIEWER_ASSET_VERSION__;
// production: data/exoplanets.json.gz?v=N → DecompressionStream("gzip") → JSON
// local:      data/exoplanets.json
```

Page-relative paths (no leading `/`) so the app works at site root **or** a subpath such as `/planetviewer/`.

### 6–7. Copy data and prune

**Must ship**

| Path in `Export/VersionN` | Role |
| --- | --- |
| `index.html` | Entry page rewritten for production |
| `app.bundle.min.js` | Bundled `js/` graph |
| `app.bundle.min.css` | Styles |
| `data/exoplanets.json.gz` | Gzipped exoplanet snapshot |
| `data/nearby-stars.json.gz` | Gzipped Gaia field-star snapshot |

**Must not ship**

| Exclude | Why |
| --- | --- |
| `data/*.json` (uncompressed) | Production uses `.json.gz` only |
| `js/` source tree | Folded into the bundle |
| `css/` source (if CSS was emitted/copied to root) | Avoid duplicate/confusion |
| `Start.cmd`, `Stop.cmd`, `.server.pid` | Local static server only |
| `scripts/fetch-*.mjs` | Release-prep / authoring, not runtime |
| `package.json`, `package-lock.json`, `node_modules/` | Not needed after bundling |
| `README.md`, `deploy.md` | Docs |
| `.git`, `.cursor`, `.gitignore` | VCS / editor |
| `Export/` | Never nest exports |
| `export-static.*`, `Export-Static.*` | Packaging tools |

### 8. Upload (optional)

Upload the **latest** `Export/VersionN` only (not the whole `Export/` tree).

| Content | Cache-Control | Content-Type | Notes |
| --- | --- | --- | --- |
| `app.bundle.min.js`, `app.bundle.min.css` | `public, max-age=31536000, immutable` | defaults | Safe with `?v=N` |
| `data/*.json.gz` | same | `application/gzip` | **Do not** set `Content-Encoding: gzip` — the client decompresses |
| `index.html` | `public, max-age=60` | `text/html; charset=utf-8` | Version stamp |

Suggested sync pattern:

1. Sync everything except `index.html` and `*.json.gz` with long cache + `--delete`.
2. Sync `*.json.gz` with `Content-Type: application/gzip` (no Content-Encoding).
3. Copy `index.html` with 60s cache.

`--delete` keeps the remote prefix aligned with this app only. Do not sync into a shared prefix used by another product without a dedicated subdirectory.

**Secure context:** WebGPU will not initialize on plain `http://` for non-localhost hosts. Prefer CloudFront (or equivalent) HTTPS in front of S3, or S3 website hosting only behind TLS.

---

## Recommended pipeline (PlanetViewer)

```text
Source tree
    │
    ▼
1. Refresh catalogs (NASA + Gaia) — fail hard unless --skip-fetch
    │
    ▼
2. Choose next Export/VersionN
    │
    ▼
3. Bundle with esbuild
      - entry: js/main.js
      - format: esm, bundle + minify
      - outfile: Export/VersionN/app.bundle.min.js
    │
    ▼
4. Emit CSS → Export/VersionN/app.bundle.min.css
    │
    ▼
5. Gzip data/*.json → Export/VersionN/data/*.json.gz
    │
    ▼
6. Write index.html
      - __PLANETVIEWER_ASSET_VERSION__ = "N"
      - link/script tags with ?v=N
      - keep canvas/UI markup from source index.html
    │
    ▼
7. Verify + optionally upload to S3
```

### Suggested esbuild sketch

```js
// conceptual — implement in export-static.mjs
import * as esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["js/main.js"],
  bundle: true,
  format: "esm",
  outfile: `Export/Version${n}/app.bundle.min.js`,
  minify: true,
  sourcemap: false,
  // Keep fetch("data/...") working as a runtime URL, not a bundled file:
  // do not try to bundle the JSON; copy it beside the HTML instead.
});
```

Do **not** use esbuild’s JSON loader to inline the entire catalog into the JS bundle unless you intentionally want a single multi‑MB script. Shipping `data/*.json.gz` separately keeps the bundle small and cacheable on its own.

### Bundler requirements

1. **ESM graph** — `js/main.js` pulls camera, catalog, WebGPU passes, UI via `import`. Use esbuild/Rollup/Vite; do not concatenate with `;\n`.
2. **No worker emit** — unlike Vulcan, there is nothing to place beside the bundle for `new Worker(...)`.
3. **Catalog stays external** — production fetches `data/*.json.gz` (local dev uses plain `.json`); paths must resolve relative to the page URL.
4. **Subpath hosting** — use relative URLs only (`data/...`, `app.bundle.min.js`), never root-absolute `/data/...`, unless you also set a base href strategy.
5. **No NASA TAP in the browser** — production only serves the snapshot baked at export time. Refresh happens **during build** (`export-static.mjs` → `fetch-exoplanets.mjs`).

---

## Default S3 target (fill in when implementing)

| Parameter | Suggested PlanetViewer default |
| --- | --- |
| Bucket | `baffledcat.com` (confirm before first upload) |
| Prefix | `planetviewer/` |
| Skip flag | `-SkipUpload` |

Print the exact `aws s3 sync` / `aws s3 cp` commands at the end of a local export even when upload is skipped.

---

## Implementation status

Scripts are in the repo:

```text
export-static.mjs       # Node packager: refresh catalog → esbuild + copy + rewrite HTML
Export-Static.ps1       # Windows wrapper: export + optional S3 upload
Export-Static.cmd       # double-click / CLI entry that calls the .ps1
```

```powershell
npm install
npm run build              # same as export-static; refreshes catalog then packages
npm run export-static
.\Export-Static.ps1 -SkipUpload
.\Export-Static.cmd        # export + upload to s3://baffledcat.com/planetviewer/
```

Catalog refresh is **on by default**. Use `--skip-fetch` / `-SkipFetch` only when offline.

### Smoke-test checklist (local `Export/VersionN`)

- [ ] Page loads; loading overlay clears
- [ ] Stats bar shows star/planet counts
- [ ] WebGPU canvas renders stars (Chrome/Edge; HTTPS or localhost)
- [ ] Catalog fetch succeeds (`data/exoplanets.json.gz` via DecompressionStream)
- [ ] Nearby-stars toggle loads Gaia field stars (`data/nearby-stars.json.gz`)
- [ ] Click star → focus travel + info panel
- [ ] SOL button returns to Sol; Earth/Mars gold (HZ); Sol ephemeris date on HUD
- [ ] Minimap auto-zoom keeps camera in middle 75%
- [ ] Time speed advances sim date / orbits
- [ ] Hosted URL is HTTPS before expecting WebGPU for real users

---

## What stays in source vs what ships

| In source (development) | In `Export/VersionN` (distribution) |
| --- | --- |
| `js/**/*.js` ES module graph | `app.bundle.min.js` |
| `css/app.css` | `app.bundle.min.css` |
| `data/exoplanets.json` | `data/exoplanets.json.gz` |
| `data/nearby-stars.json` | `data/nearby-stars.json.gz` |
| `Start.cmd` / `Stop.cmd` / `npm start` | Omitted |
| `scripts/fetch-*.mjs` | Omitted (run during export) |
| Working tree as edited | Frozen snapshot for that version number |

## Checklist for a healthy export

- [ ] Catalog was refreshed during build (or `--skip-fetch` was explicit)
- [ ] New `Export/VersionN` created (number incremented)
- [ ] No `Start.cmd` / `Stop.cmd` / fetch script / `js/` sources in the version folder
- [ ] `index.html` references production bundle + CSS (not `js/main.js` / `css/app.css`)
- [ ] `data/exoplanets.json.gz` and `data/nearby-stars.json.gz` present (no uncompressed JSON)
- [ ] Asset version `?v=N` on JS/CSS (and catalog fetch)
- [ ] Minified bundle present when the bundler runs with minify; otherwise explicit unminified fallback
- [ ] Upload (if used) targets only the latest version folder with appropriate cache headers
- [ ] Hosted URL is a secure context (HTTPS) so WebGPU can initialize

## Design notes

- **Module bundler required.** PlanetViewer already uses ES modules; keep versioned `Export/VersionN` and upload stages, bundle with esbuild (not script concatenation).
- **Catalog is the bulky asset.** Export gzipped `data/*.json.gz`, long-cache, version-query via HTML stamp; client decompresses with `DecompressionStream`.
- **Version folders are the artefact of record.** Publish a folder, not a floating overwritten `dist/`.
- **Fail hard on catalog refresh / missing bundle; keep upload optional.** A failed NASA TAP fetch (unless `--skip-fetch`), failed esbuild, or missing catalog should abort the export. `-SkipUpload` must still produce a complete local folder.
- **Keep the wrapper thin.** The packager owns packaging logic; the shell script owns environment checks and upload.
- **Dev workflow stays.** `Start.cmd` / `npm start` remain daily development. Export is a release step.
