/**
 * Fetch NASA Exoplanet Archive PSCompPars via TAP and write data/exoplanets.json.
 *
 * Usage: node scripts/fetch-exoplanets.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pressLabel } from "./star-label.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "exoplanets.json");

const COLUMNS = [
  "hostname",
  "pl_name",
  "sy_snum",
  "sy_pnum",
  "cb_flag",
  "ra",
  "dec",
  "sy_dist",
  "st_spectype",
  "st_teff",
  "st_rad",
  "st_lum",
  "st_mass",
  "sy_vmag",
  "pl_orbsmax",
  "pl_orbper",
  "pl_orbeccen",
  "pl_orbincl",
  "pl_orblper",
  // Longitude of ascending node (Ω) is not published in PSCompPars; Catalog
  // assigns a stable per-host nodeDeg when missing. Persist if a future column appears.
  "pl_rade",
  "pl_radj",
  "pl_bmasse",
  "discoverymethod",
  "disc_year",
  "disc_facility",
].join(",");

const query = `select ${COLUMNS} from pscomppars where sy_dist is not null and ra is not null and dec is not null`;
const url =
  "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=" +
  encodeURIComponent(query) +
  "&format=json";

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v) {
  if (v == null || v === "") return null;
  return String(v);
}

/** NASA st_lum is log10(L/L☉); store linear L☉ for the app. */
function luminosityFromLog10(stLum) {
  const logL = num(stLum);
  if (logL == null) return null;
  return 10 ** logL;
}

console.log("Fetching PSCompPars from NASA Exoplanet Archive…");
const res = await fetch(url);
if (!res.ok) {
  throw new Error(`TAP request failed: ${res.status} ${res.statusText}`);
}
const rows = await res.json();
console.log(`Received ${rows.length} planet rows`);

/** @type {Map<string, object>} */
const byHost = new Map();

for (const row of rows) {
  const name = str(row.hostname);
  if (!name) continue;
  const distPc = num(row.sy_dist);
  const ra = num(row.ra);
  const dec = num(row.dec);
  if (distPc == null || distPc <= 0 || ra == null || dec == null) continue;

  let system = byHost.get(name);
  if (!system) {
    system = {
      name,
      label: pressLabel(name),
      ra,
      dec,
      distPc,
      spectype: str(row.st_spectype),
      teff: num(row.st_teff),
      radius: num(row.st_rad),
      luminosity: luminosityFromLog10(row.st_lum),
      mass: num(row.st_mass),
      vmag: num(row.sy_vmag),
      snum: num(row.sy_snum),
      pnum: num(row.sy_pnum),
      planets: [],
    };
    byHost.set(name, system);
  } else {
    // Fill missing stellar fields from later rows
    if (!system.spectype && row.st_spectype) system.spectype = str(row.st_spectype);
    if (system.teff == null && row.st_teff != null) system.teff = num(row.st_teff);
    if (system.radius == null && row.st_rad != null) system.radius = num(row.st_rad);
    if (system.luminosity == null && row.st_lum != null) {
      system.luminosity = luminosityFromLog10(row.st_lum);
    }
    if (system.mass == null && row.st_mass != null) system.mass = num(row.st_mass);
    if (system.vmag == null && row.sy_vmag != null) system.vmag = num(row.sy_vmag);
  }

  const planetName = str(row.pl_name);
  if (!planetName) continue;
  if (system.planets.some((p) => p.name === planetName)) continue;

  system.planets.push({
    name: planetName,
    a: num(row.pl_orbsmax),
    periodDays: num(row.pl_orbper),
    e: num(row.pl_orbeccen),
    inclDeg: num(row.pl_orbincl),
    omegaDeg: num(row.pl_orblper),
    nodeDeg: num(row.pl_orbnode ?? row.pl_orblong ?? null),
    radiusEarth: num(row.pl_rade),
    radiusJupiter: num(row.pl_radj),
    massEarth: num(row.pl_bmasse),
    // Discovery is per planet, not per host: one system can mix methods/years
    discoveryMethod: str(row.discoverymethod),
    discoveryYear: num(row.disc_year),
    discoveryFacility: str(row.disc_facility),
    cbFlag: num(row.cb_flag) === 1,
  });
}

const systems = [...byHost.values()].sort((a, b) => a.distPc - b.distPc);
const relabeled = systems.filter((s) => s.label !== s.name).length;
console.log(`${relabeled} of ${systems.length} hosts have press labels distinct from hostname`);
const payload = {
  source: "NASA Exoplanet Archive PSCompPars",
  fetchedAt: new Date().toISOString(),
  /** Linear solar luminosities (converted from NASA st_lum = log10(L/L☉)). */
  luminosityUnit: "Lsun",
  systemCount: systems.length,
  planetCount: systems.reduce((n, s) => n + s.planets.length, 0),
  systems,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(payload));
console.log(`Wrote ${systems.length} systems → ${OUT}`);
