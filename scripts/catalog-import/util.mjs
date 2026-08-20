import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(here, "..", "..");
export const DATA_DIR = join(ROOT, "data");

export const EXOPLANETS_PATH = join(DATA_DIR, "exoplanets.json");
export const NEARBY_PATH = join(DATA_DIR, "nearby-stars.json");
export const CLOSE_BINARIES_PATH = join(DATA_DIR, "close-binaries.json");
export const CURATED_PATH = join(DATA_DIR, "close-binaries-curated.json");
export const STATS_PATH = join(DATA_DIR, "catalog-import-stats.json");

export function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function str(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  return s ? s : null;
}

/** NASA st_lum is log10(L/L☉); store linear L☉ for the app. */
export function luminosityFromLog10(stLum) {
  const logL = num(stLum);
  if (logL == null) return null;
  return 10 ** logL;
}

/** Kepler III: P (days) from a (AU) and M1+M2 (M☉). */
export function periodDaysFromMasses(aAu, mTot) {
  if (!aAu || aAu <= 0 || !mTot || mTot <= 0) return null;
  const pYears = Math.sqrt((aAu * aAu * aAu) / mTot);
  return pYears * 365.25;
}

/** Kepler III: a (AU) from P (days) and M1+M2 (M☉). */
export function aFromPeriodMasses(periodDays, mTot) {
  if (!periodDays || periodDays <= 0 || !mTot || mTot <= 0) return null;
  const pYears = periodDays / 365.25;
  return Math.cbrt(pYears * pYears * mTot);
}

export function createLogger(onLog) {
  return (msg) => {
    const text = String(msg);
    console.log(text);
    onLog?.(text);
  };
}

export async function fetchJson(url, init = {}) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return res.json();
}

export async function fetchText(url, init = {}) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return res.text();
}

/**
 * Angular separation in degrees → projected AU at distPc.
 * 1 arcsec at 1 pc = 1 AU.
 */
export function projectedSepAu(ra1, dec1, ra2, dec2, distPc) {
  if ([ra1, dec1, ra2, dec2, distPc].some((v) => v == null || !Number.isFinite(v))) return null;
  if (distPc <= 0) return null;
  const d2r = Math.PI / 180;
  const cosd =
    Math.sin(dec1 * d2r) * Math.sin(dec2 * d2r) +
    Math.cos(dec1 * d2r) * Math.cos(dec2 * d2r) * Math.cos((ra1 - ra2) * d2r);
  const deg = Math.acos(Math.min(1, Math.max(-1, cosd))) / d2r;
  return deg * 3600 * distPc;
}

export function kindFromSnum(snum) {
  if (snum >= 4) return "quadruple";
  if (snum === 3) return "triple";
  if (snum === 2) return "binary";
  return "single";
}

/**
 * Draw companion in the focused orbit view if the pair is close in absolute
 * terms or the planet reaches ≥5% of the binary orbit.
 */
export function shouldDrawBinary({ a, circumbinary, planets }) {
  if (a == null || !(a > 0)) return false;
  if (circumbinary && a <= 1) return true;
  if (a <= 5) return true;
  let outer = 0;
  for (const p of planets || []) {
    if (p?.a != null && p.a > outer) outer = p.a;
  }
  return outer > 0 && a <= 20 * outer;
}

export function sliceField(line, start1, end1) {
  return str(line.slice(start1 - 1, end1));
}

export function parseVizierTsv(text) {
  const lines = String(text).split(/\r?\n/);
  const rows = [];
  let headers = null;
  for (const raw of lines) {
    if (!raw || raw.startsWith("#") || raw.startsWith("-")) continue;
    const cols = raw.split("\t");
    if (!headers) {
      headers = cols.map((h) => h.trim());
      continue;
    }
    if (cols.length < 2) continue;
    const row = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = cols[i] ?? "";
    rows.push(row);
  }
  return rows;
}

export function parseVizierJson(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.data)) {
    const cols = (raw.metadata || []).map((m) => m.name);
    if (cols.length && Array.isArray(raw.data[0])) {
      return raw.data.map((arr) => {
        const o = {};
        for (let i = 0; i < cols.length; i++) o[cols[i]] = arr[i];
        return o;
      });
    }
    return raw.data;
  }
  throw new Error("Unexpected VizieR JSON shape: " + Object.keys(raw || {}).join(","));
}

export function scoreStarRow(row) {
  let n = 0;
  if (num(row.st_mass) != null) n += 4;
  if (num(row.st_rad) != null) n += 2;
  if (num(row.st_teff) != null) n += 2;
  if (str(row.st_spectype)) n += 1;
  if (str(row.gaia_dr3_id) || str(row.gaia_id)) n += 1;
  return n;
}

export function letterFromHostname(hostname) {
  const m = /(?:^|[\s-])([A-D])$/i.exec(String(hostname || "").trim());
  return m ? m[1].toUpperCase() : null;
}
