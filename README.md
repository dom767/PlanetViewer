# PlanetViewer

Interactive 3D map of known exoplanet host systems around Sol. Stars are placed at catalog distances (parsecs) from Earth’s Sun, coloured by spectral type / effective temperature, and sized by stellar radius and brightness. Selecting a star pans the camera and opens an info panel; focused systems show exaggerated AU-scale orbits that advance with simulation time.

Built with **vanilla HTML + ES modules + WebGPU** (no Three.js). Soft particle billboards use premultiplied-alpha / additive blending with depth testing and no depth writes for correct transparency.

## Quick start

WebGPU requires a local HTTP server and a recent Chromium-based browser (Chrome/Edge 113+):

```bash
# Python
python -m http.server 8080

# Node (if you have npx)
npx --yes serve -p 8080
```

Open [http://localhost:8080](http://localhost:8080).

On first load, pick one of five **guided tours** or **Free flight**. Amber bookmarks mark the active tour; **Next** hops along it. Change tour from the HUD.

## Controls

| Input | Action |
| --- | --- |
| WASD | Move (leaves a focused system in free flight, keeping the current view) |
| Q / E | Down / up |
| Shift | Faster |
| Space | Slower |
| Scroll | Zoom (orbit) / dolly |
| Drag on star | Orbit around star |
| Click near a star | Focus (+ info panel on desktop; use Info on mobile) |
| Esc | Close panel or tour picker |
| Minimap click | Jump toward that XY position |
| Time dropdown | Orbit simulation speed |
| Home | Return to Sol |
| Next | Next stop on the active tour (wraps) |
| Change tour / Select Tour | Reopen the tour picker. Picking a star off the active tour ends it. |
| Fullscreen | Settings toggle (hidden if the browser cannot fullscreen; Esc exits) |
| TikTok record | Settings toggle — on phones, parks info/search/settings sheets in the TikTok safe zone (~15% from the top) |

## Data

Catalog snapshot: [`data/exoplanets.json`](data/exoplanets.json) from the [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/) **PSCompPars** table (TAP). Directly imaged hosts may show a telescope still from [`data/system-images.json`](data/system-images.json) (curated via the probe dashboard; refresh with `npm run fetch-system-images`).

Refresh the snapshots (requires network; separate from packaging):

```bash
npm run fetch-data
# or separately:
node scripts/fetch-exoplanets.mjs
node scripts/fetch-nearby-stars.mjs
# Windows: Fetch-Data.cmd
```

Then package a release from the existing snapshots:

```bash
npm run export-static
# Windows: Export-Static.cmd
```

**Nearby stars toggle:** Gaia DR3 stars within **30 pc** of Sol (60 pc diameter) that are not near a known exoplanet host. Off by default; enable with “Nearby stars (≤30 pc)” under Settings.

## Dual scale

- **Fly scale:** host positions in parsecs from Sol.
- **System scale:** when focused, planet orbits are drawn in a local AU frame remapped so the outermost orbit fits ~0.85 pc of screen space. The HUD shows “Local orbits exaggerated” while focused.

## Project layout

```
index.html
css/app.css
js/main.js
js/astro/          # coordinates, spectrum, orbits
js/camera/         # free-fly camera + focus tween
js/catalog/        # system catalog + picking
js/data/loader.js
js/render/         # WebGL2 Scene, StarPass, PlanetPass
js/content/        # star notes, tours, landmarks, system stills
js/ui/             # InfoPanel, Minimap, Hud, TourPicker
data/exoplanets.json
data/nearby-stars.json
data/system-images.json
images/
scripts/fetch-exoplanets.mjs
```

## WebGPU notes

Stars use **additive** blending; planets, orbits, and the hover ring use **premultiplied alpha**. Soft discs are screen-space billboard quads (WebGPU has no reliable point sprites). Depth is tested but not written for transparent passes so overlapping glows composite correctly.
