# Exoplanet Viewer

*A sales-pitch blurb for the interactive 3D map of known worlds beyond Sol.*

---

## A sky full of neighbours

For most of human history, planets meant *our* planets — Mercury through Neptune, and the odd companion of Sol. That changed in a generation. In 1992, astronomers confirmed planets around a distant pulsar; in October 1995, Michel Mayor and Didier Queloz found **51 Pegasi b**, the first confirmed world orbiting a Sun-like star, and opened the modern age of exoplanet science. Thirty years later, NASA’s Exoplanet Archive lists **more than 6,000 confirmed planets**, with thousands more candidates still awaiting confirmation — and the pace of discovery keeps accelerating.

Those numbers are only a sample of what is out there. Surveys suggest that **most stars host planets**, and that **roughly one in five Sun-like stars** may have an Earth-sized world in the habitable zone — the “Goldilocks” region where liquid water could exist on a surface. Fold in the galaxy’s abundant red dwarfs and estimates climb toward **tens of billions** of potentially temperate rocky worlds in the Milky Way alone. We have not visited any of them. We *have* measured their orbits, radii, masses, and discovery stories — and we can put those measured systems on a map around the Sun we already know.

**Exoplanet Viewer** is that map: fly from Sol into the catalogue of known host stars, park in exaggerated orbit around a planetary plane, and read what we know — including which planets fall in a star’s Goldilocks zone.

---

## What the application does

Exoplanet Viewer is an interactive **WebGPU** experience that places known exoplanet host systems in 3D space around Sol. Stars sit at their catalogued distances (parsecs from Earth), coloured by spectral type and temperature, and sized by radius and brightness. Click or search a system and the camera travels there smoothly, then settles into an overlook orbit aligned with that system’s planetary plane.

Once you arrive, local orbits are drawn at an **exaggerated AU scale** so multi-planet systems read clearly on screen (the outer orbit is remapped into a comfortable viewing radius). Simulation time can be sped up so orbits advance from paused to years-per-second. Habitable-zone candidates are highlighted in gold. An information panel summarises stellar properties, planet sizes and periods, and — where available — how and when each planet was discovered, and at which facility.

On desktop you also get a plan-view minimap of the catalogue and live stats. A four-item navigation chrome (**Home**, **Search**, **Info**, **Settings**) is designed for both desktop and mobile: Home returns to Sol, Search finds systems by name prefix, Info toggles system details, and Settings covers exposure, orbit time, and optional nearby field stars.

---

## What you will see in the catalogue

The bundled snapshot currently includes on the order of **~4,700 host systems** and **~6,300 planets** with usable sky position and distance (exact counts refresh when data is re-fetched). Most confirmed discoveries in the archive were found by **transit** photometry (missions and surveys such as Kepler, K2, and TESS), with large contributions from **radial velocity**, plus imaging, microlensing, and rarer timing methods. Discovery method, year, and facility are stored per planet and shown in the UI.

Sol itself is included as the origin, with a schematic eight-planet solar system so you always have a familiar reference before you hop outward.

---

## Data sources

| Dataset | Source | Role in the app |
| --- | --- | --- |
| Exoplanet hosts & planets | [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/) **PSCompPars** (via TAP) | Positions (RA/Dec/distance), stellar parameters, orbital elements, planet sizes/masses, discovery metadata |
| Nearby field stars | [Gaia DR3](https://www.cosmos.esa.int/web/gaia) (TAP) | Optional overlay of stars within **~30 pc** of Sol that are *not* known exoplanet hosts — for local context |

Catalogues ship as local JSON snapshots (`data/exoplanets.json`, `data/nearby-stars.json`) so the experience loads offline after the first build. Production exports can serve gzipped copies. Refresh scripts re-query NASA and Gaia when you want a newer snapshot.

Orbital geometry for exoplanets uses published elements where available; some angles (notably longitude of ascending node) are filled with stable, system-local defaults when the archive does not publish them. Habitable-zone tagging is an **approximate** luminosity-scaled “recent Venus / early Mars” style band — a schematic guide for exploration, not a mission-selection claim.

---

## Who it is for

Anyone who wants to *feel* the scale of the known exoplanet neighbourhood: educators, outreach teams, curious readers of astronomy news, and developers exploring a compact WebGPU demo. No account, no install — open it in a recent Chromium-based browser with WebGPU, and start at Sol.

The sky is no longer empty. **Come fly through the ones we have found.**
