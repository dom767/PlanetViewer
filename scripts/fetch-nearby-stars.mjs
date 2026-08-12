/**
 * Fetch Gaia DR3 stars within 30 pc (60 pc diameter around Sol)
 * and write data/nearby-stars.json.
 *
 * Usage: node scripts/fetch-nearby-stars.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "data", "nearby-stars.json");

/** 30 pc ⇒ parallax ≥ 1000/30 mas */
const MIN_PARALLAX_MAS = 1000 / 30;

const query = `
SELECT source_id, ra, dec, parallax, phot_g_mean_mag, bp_rp
FROM gaiadr3.gaia_source
WHERE parallax >= ${MIN_PARALLAX_MAS}
  AND parallax_over_error > 10
  AND ruwe < 1.4
  AND phot_g_mean_mag IS NOT NULL
`.replace(/\s+/g, " ").trim();

const body = new URLSearchParams({
  REQUEST: "doQuery",
  LANG: "ADQL",
  FORMAT: "json",
  QUERY: query,
});

function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

console.log("Fetching Gaia DR3 stars within 30 pc…");
const res = await fetch("https://gea.esac.esa.int/tap-server/tap/sync", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body,
});
if (!res.ok) {
  const text = await res.text();
  throw new Error(`Gaia TAP failed: ${res.status} ${res.statusText}\n${text.slice(0, 500)}`);
}

const raw = await res.json();
// Gaia JSON can be { data: [...] } with metadata, or VOTable-like arrays
let rows = [];
if (Array.isArray(raw)) {
  rows = raw;
} else if (Array.isArray(raw.data)) {
  // Often [[col,...], ...] with metadata.columns
  const cols = (raw.metadata || []).map((m) => m.name);
  if (cols.length && Array.isArray(raw.data[0])) {
    rows = raw.data.map((arr) => {
      const o = {};
      for (let i = 0; i < cols.length; i++) o[cols[i]] = arr[i];
      return o;
    });
  } else {
    rows = raw.data;
  }
} else {
  throw new Error("Unexpected Gaia TAP JSON shape: " + Object.keys(raw).join(","));
}

const stars = [];
for (const row of rows) {
  const ra = num(row.ra);
  const dec = num(row.dec);
  const plx = num(row.parallax);
  if (ra == null || dec == null || plx == null || plx <= 0) continue;
  const distPc = 1000 / plx;
  if (distPc > 30) continue;
  stars.push({
    sourceId: String(row.source_id ?? ""),
    ra,
    dec,
    distPc,
    gMag: num(row.phot_g_mean_mag),
    bpRp: num(row.bp_rp),
  });
}

stars.sort((a, b) => a.distPc - b.distPc);

const payload = {
  source: "Gaia DR3 (TAP) — stars with parallax ≥ 33.33 mas (~30 pc)",
  radiusPc: 30,
  diameterPc: 60,
  fetchedAt: new Date().toISOString(),
  starCount: stars.length,
  stars,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(payload));
console.log(`Wrote ${stars.length} nearby stars → ${OUT}`);
