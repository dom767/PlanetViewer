# System image probe dashboard

Local tool to probe six image sources for each directly imaged catalog host and compare results in a table.

## Prerequisites

- **Node.js** (same as the main project)
- **Python** with Pillow for 64×64 thumbnail generation (`scripts/resize-square.py`)

## Run

**Windows (recommended):** double-click **`Probe-Dashboard.cmd`** at the repo root, or run it from a terminal. Opens `http://localhost:8765/` in your browser.

**npm:**

```bash
npm run probe-dashboard
```

Then open http://localhost:8765/

## What it does

For each imaging host (~82 systems), the dashboard probes independently:

| Column | Source |
|--------|--------|
| ESO title | ESO archive title search |
| ESO news | ESO news → related image |
| Commons | Wikimedia Commons quoted search |
| NASA | NASA Image Library |
| Wikipedia | [List of directly imaged exoplanets](https://en.wikipedia.org/wiki/List_of_directly_imaged_exoplanets) → Commons file |
| OEC | Open Exoplanet Catalogue XML + outreach images |

- **Check all** runs every host sequentially (several minutes due to API rate limits). Progress updates as each host finishes.
- **↻** on a row reruns a single host.
- **Attribution** ✓ when the winning hit has usable credit and license for the app.
- **Preview** shows a 64×64 thumb when a winner exists.

Results are cached locally in `tools/system-image-probe/results.json` and `thumbs/` (not committed).

## Column meanings

- Source columns: ✓ = hit passed score/reject filters; ✗ = no hit or below threshold. Hover for title, score, errors.
- **Winner** = best hit across all six sources (`pickBestFromHits` scoring).
- The fetch pipeline (`npm run fetch-system-images`) still uses ESO → Commons → NASA only; wiki/OEC are for evaluation here.

## Dev smoke test

Probe a single host from the UI (e.g. **HIP 78530** → expect OEC ✓, **51 Eri** → Commons ✓).

Or limit fetch after refactor:

```bash
node scripts/fetch-system-images.mjs --dry-run --limit 5
```
