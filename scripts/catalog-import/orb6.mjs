import { fetchText, num, str } from "./util.mjs";

const URLS = [
  "https://crf.usno.navy.mil/data_products/WDS/orb6/orb6.master",
  "https://www.astro.gsu.edu/wds/orb6/orb6.txt",
  "https://crf.usno.navy.mil/data_products/WDS/orb6/orb6.txt",
];

function periodDays(per, unit) {
  const p = num(per);
  if (p == null || p <= 0) return null;
  const u = String(unit || "y").toLowerCase().trim();
  if (u === "d") return p;
  if (u === "c") return p * 365.25 * 100;
  return p * 365.25;
}

function aArcsec(value, unit) {
  const a = num(value);
  if (a == null || a <= 0) return null;
  const u = String(unit || "a").trim();
  if (u === "m") return a / 1000;
  if (u === "M") return a * 60;
  if (u === "u") return a / 1e6;
  return a;
}

/** Official one-line ORB6 text catalog (orb6format.txt columns, 1-indexed). */
function parseFixedOrb6(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length < 116) continue;
    if (line.startsWith("RA") || line.startsWith("column") || /^\s/.test(line) === false && line.startsWith("Sixth")) continue;
    if (!/^\d{6}/.test(line.trim()) && !/^\d{2}/.test(line)) continue;
    const hd = num(line.slice(51, 57));
    const hip = num(line.slice(58, 64));
    const per = line.slice(81, 93);
    const perUnit = line.slice(93, 94);
    const aRaw = line.slice(105, 115);
    const aUnit = aRaw.slice(-1);
    const aVal = aRaw.slice(0, -1);
    const a = aArcsec(aVal, aUnit);
    if (!a) continue;
    rows.push({
      hd: Number.isFinite(hd) ? hd : null,
      hip: Number.isFinite(hip) ? hip : null,
      wds: str(line.slice(19, 29)),
      aArcsec: a,
      periodDays: periodDays(per, perUnit),
      e: num(line.slice(187, 195)),
      inclDeg: num(line.slice(125, 133)),
      nodeDeg: num(line.slice(143, 151)),
      omegaDeg: num(line.slice(205, 213)),
    });
  }
  return rows;
}

/** orb6.master is one orbit per line with space-separated elements and unit flags. */
function parseMasterOrb6(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.length < 80 || line.startsWith("RA") || line.startsWith("000000000")) continue;
    const m = line.match(
      /^\S+\s+\S+\s+.+?\s+(\d{2,6}|\.)\s+(\d{1,6}|\.)\s+[\d.]+\s*\S?\s+[\d.]+\s*\S?\s+([\d.]+)\s+([dyc])\s+\S+\s+([\d.]+)\s+([amMu])/
    );
    if (!m) continue;
    const hd = m[1] === "." ? null : num(m[1]);
    const hip = m[2] === "." ? null : num(m[2]);
    const a = aArcsec(m[5], m[6]);
    if (!a) continue;
    rows.push({
      hd,
      hip,
      wds: null,
      aArcsec: a,
      periodDays: periodDays(m[3], m[4]),
      e: null,
      inclDeg: null,
      nodeDeg: null,
      omegaDeg: null,
    });
  }
  return rows;
}

export async function fetchOrb6(log) {
  let lastErr;
  for (const url of URLS) {
    try {
      log?.(`Fetching ORB6: ${url}`);
      const text = await fetchText(url);
      if (text.length < 1000) throw new Error("response too short");
      const fixed = parseFixedOrb6(text);
      const rows = fixed.length > 50 ? fixed : parseMasterOrb6(text);
      const usable = rows.filter((r) => r.aArcsec && (r.hd || r.hip));
      log?.(`ORB6: ${usable.length} orbits with HD/HIP (${url})`);
      if (usable.length) return usable;
      lastErr = new Error("no HD/HIP orbits parsed");
    } catch (err) {
      lastErr = err;
      log?.(`  failed: ${err.message}`);
    }
  }
  throw lastErr;
}

export function aAuFromOrb6(row, distPc) {
  if (!row?.aArcsec || !distPc || distPc <= 0) return null;
  return row.aArcsec * distPc;
}
