# System image probe dashboard

Local tool to probe five image sources for each directly imaged catalog host and compare results in a table.

## Prerequisites

- **Node.js** (same as the main project)
- **Python** with Pillow for 64×64 thumbnail generation (`scripts/resize-square.py`)

## Run

**Windows (recommended):** double-click **`Probe-Dashboard.cmd`** at the repo root, or run it from a terminal. Opens `http://localhost:8765/` in your browser. Stop with **`Stop-Probe-Dashboard.cmd`**.

**npm:**

```bash
npm run probe-dashboard
```

Then open http://localhost:8765/

## What it does

Search uses the **host name**, **press aliases**, **planet names**, and **survey coordinate short forms** (e.g. `VHS J125601.92-125723.9` also queries `VHS J1256-1257`).

| Column | Source |
|--------|--------|
| ESO title | ESO archive title search |
| Commons | Wikimedia Commons quoted search |
| NASA | NASA Image Library |
| Wikipedia | [List of directly imaged exoplanets](https://en.wikipedia.org/wiki/List_of_directly_imaged_exoplanets) → Commons file |
| OEC | Open Exoplanet Catalogue XML + outreach images |

- **Check all** runs every host sequentially (several minutes due to API rate limits). Progress updates as each host finishes.
- **Check missing** runs only hosts with no selected image (same as the “no selection” count in the stats bar).
- **↻** on a row reruns a single host.
- **Attribution** ✓ when the winning hit has usable credit and license for the app.
- **Preview** shows the selected source’s 64×64 thumb; click to view the 300×300 image in-page.
- Each source **✓** also opens that source’s 300×300 preview in the same lightbox.
- **Live status** overlay opens when probing starts; shows host/source progress and a log. **Close** is enabled when the run finishes.

Results are cached locally in `tools/system-image-probe/results.json` and `thumbs/` (not committed).

## Column meanings

- Source columns: **Queried** (in progress), **Nothing found** (queried but no match), or **Successful** (match found). Hover for title, score, errors.
- **Winner** = best hit across all five sources (`pickBestFromHits` scoring).
- Each host record stores **`probeServerVersion`** — the probe server version that ran the query.
- The fetch pipeline (`npm run fetch-system-images`) still uses ESO → Commons → NASA only; wiki/OEC are for evaluation here.

## Dev smoke test

Probe a single host from the UI (e.g. **HIP 78530** → expect OEC ✓, **51 Eri** → Commons ✓).

Or limit fetch after refactor:

```bash
node scripts/fetch-system-images.mjs --dry-run --limit 5
```
