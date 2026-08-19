/**
 * Merge curated ≤5 AU binary orbits with NASA Stellar Hosts TAP params.
 *
 * Usage: node scripts/fetch-close-binaries.mjs
 *
 * Does not invent separations for every sy_snum ≥ 2. A second star is only
 * emitted when curated `a` or `sepAu` is present and ≤ 5 AU.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CURATED = join(ROOT, "data", "close-binaries-curated.json");
const OUT = join(ROOT, "data", "close-binaries.json");

const MAX_SEP_AU = 5;

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v) {
  if (v == null || v === "") return null;
  return String(v);
}

/** Kepler III: P (days) from a (AU) and M1+M2 (M☉). */
function periodDaysFromMasses(aAu, mTot) {
  if (!aAu || aAu <= 0 || !mTot || mTot <= 0) return null;
  const pYears = Math.sqrt((aAu * aAu * aAu) / mTot);
  return pYears * 365.25;
}

function letterFromHostname(hostname) {
  const m = /(?:^|[\s-])([A-D])$/i.exec(String(hostname).trim());
  return m ? m[1].toUpperCase() : null;
}

function scoreStarRow(row) {
  let n = 0;
  if (num(row.st_mass) != null) n += 4;
  if (num(row.st_rad) != null) n += 2;
  if (num(row.st_teff) != null) n += 2;
  if (str(row.st_spectype)) n += 1;
  return n;
}

/**
 * Best TAP row per hostname (most complete stellar params).
 * @param {object[]} rows
 */
function bestRowsByHostname(rows) {
  /** @type {Map<string, object>} */
  const best = new Map();
  for (const row of rows) {
    const host = str(row.hostname);
    if (!host) continue;
    const prev = best.get(host);
    if (!prev || scoreStarRow(row) > scoreStarRow(prev)) best.set(host, row);
  }
  return best;
}

function starFromRow(row, letterFallback) {
  return {
    letter: letterFromHostname(row.hostname) || letterFallback,
    hostname: str(row.hostname),
    teff: num(row.st_teff),
    radius: num(row.st_rad),
    mass: num(row.st_mass),
    spectype: str(row.st_spectype),
  };
}

function mergeStar(curated, tap, letter) {
  const c = curated || {};
  const t = tap || {};
  return {
    letter: c.letter || t.letter || letter,
    teff: c.teff ?? t.teff ?? null,
    radius: c.radius ?? t.radius ?? null,
    mass: c.mass ?? t.mass ?? null,
    spectype: c.spectype ?? t.spectype ?? null,
  };
}

function pickCompanionStars(syName, tapByHost, curatedStars) {
  const prefix = String(syName).toLowerCase();
  const tapStars = [];
  for (const [host, row] of tapByHost) {
    const h = host.toLowerCase();
    if (h === prefix || h.startsWith(`${prefix} `) || h.startsWith(`${prefix}-`)) {
      tapStars.push(starFromRow(row, null));
    }
  }
  tapStars.sort((a, b) => (a.letter || "Z").localeCompare(b.letter || "Z"));

  const byLetter = new Map();
  for (const s of tapStars) {
    if (s.letter) byLetter.set(s.letter, s);
  }

  const aTap = byLetter.get("A") || tapStars[0] || null;
  const bTap =
    byLetter.get("B") ||
    tapStars.find((s) => s !== aTap) ||
    null;

  return [
    mergeStar(curatedStars[0], aTap, "A"),
    mergeStar(curatedStars[1], bTap, "B"),
  ];
}

async function fetchStellarHosts(names) {
  if (!names.length) return [];
  const quoted = names.map((n) => `'${String(n).replace(/'/g, "''")}'`).join(",");
  const query = `select sy_name,hostname,sy_snum,st_spectype,st_teff,st_rad,st_mass from stellarhosts where sy_snum >= 2 and (sy_name in (${quoted}) or hostname in (${quoted}))`;
  const url =
    "https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=" +
    encodeURIComponent(query) +
    "&format=json";
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`stellarhosts TAP failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

const curatedRaw = JSON.parse(await readFile(CURATED, "utf8"));
const curatedList = curatedRaw.binaries || [];
const names = [...new Set(curatedList.map((b) => b.hostname).filter(Boolean))];

let tapRows = [];
try {
  console.log(`Fetching stellarhosts for ${names.length} curated close binaries…`);
  tapRows = await fetchStellarHosts(names);
  console.log(`Received ${tapRows.length} stellarhosts rows`);
} catch (err) {
  console.warn(`stellarhosts TAP unavailable (${err.message}); using curated params only`);
}

const tapByHost = bestRowsByHostname(tapRows);

/** @type {object[]} */
const binaries = [];
for (const cur of curatedList) {
  const hostname = str(cur.hostname);
  if (!hostname) continue;

  const a = num(cur.a) ?? num(cur.sepAu);
  if (a == null || a <= 0 || a > MAX_SEP_AU) {
    console.warn(`Skipping ${hostname}: need a or sepAu ≤ ${MAX_SEP_AU} AU`);
    continue;
  }

  const stars = pickCompanionStars(hostname, tapByHost, cur.stars || []);
  const m1 = stars[0].mass;
  const m2 = stars[1].mass;
  const mTot = (m1 || 0) + (m2 || 0);

  let periodDays = num(cur.periodDays);
  let orbitInferred = !!cur.orbitInferred;
  const fromSep = num(cur.a) == null && num(cur.sepAu) != null;
  if (fromSep) orbitInferred = true;

  if ((periodDays == null || periodDays <= 0) && mTot > 0) {
    periodDays = periodDaysFromMasses(a, mTot);
    orbitInferred = true;
  }

  binaries.push({
    hostname,
    a,
    periodDays,
    e: num(cur.e) ?? (orbitInferred ? 0 : null),
    inclDeg: num(cur.inclDeg),
    omegaDeg: num(cur.omegaDeg),
    nodeDeg: num(cur.nodeDeg),
    orbitInferred,
    circumbinary: cur.circumbinary === true,
    stars,
  });
}

const payload = {
  source: "curated Keplerian orbits + NASA Exoplanet Archive stellarhosts",
  fetchedAt: new Date().toISOString(),
  maxSepAu: MAX_SEP_AU,
  binaryCount: binaries.length,
  binaries,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");
console.log(`Wrote ${binaries.length} close binaries → ${OUT}`);
