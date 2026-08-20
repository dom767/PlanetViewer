import { extractHd, extractHip } from "./names.mjs";
import { fetchJson, fetchText, num, parseVizierJson, parseVizierTsv, str } from "./util.mjs";

const TAP =
  "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=";

function vizTsv(table) {
  return `https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=${table}&-out.max=unlimited`;
}

async function fetchTable(table, log) {
  try {
    const q = encodeURIComponent(`SELECT * FROM "${table}"`);
    return parseVizierJson(await fetchJson(TAP + q));
  } catch (err) {
    log?.(`SB9 TAP ${table} failed (${err.message}); trying TSV`);
    return parseVizierTsv(await fetchText(vizTsv(table)));
  }
}

function seqOf(row) {
  return num(row.Seq ?? row.seq ?? row.recno);
}

export async function fetchSb9(log) {
  log?.("Fetching SB9 spectroscopic-binary orbits from VizieR…");
  const [aliasRows, orbitRows] = await Promise.all([
    fetchTable("B/sb9/alias", log),
    fetchTable("B/sb9/orbits", log),
  ]);

  /** @type {Map<number, {names: string[], hd: number|null, hip: number|null}>} */
  const aliases = new Map();
  for (const row of aliasRows) {
    const seq = seqOf(row);
    const name = str(row.Name ?? row.name ?? row.ID);
    if (seq == null || !name) continue;
    if (!aliases.has(seq)) aliases.set(seq, { names: [], hd: null, hip: null });
    const rec = aliases.get(seq);
    rec.names.push(name);
    rec.hd = rec.hd || extractHd(name);
    rec.hip = rec.hip || extractHip(name);
  }

  /** @type {Map<number, object>} */
  const bestOrbit = new Map();
  for (const row of orbitRows) {
    const seq = seqOf(row);
    if (seq == null) continue;
    const periodDays = num(row.Per ?? row.per ?? row.P);
    if (periodDays == null || periodDays <= 0) continue;
    const grade = num(row.Grade ?? row.grade) ?? 99;
    const prev = bestOrbit.get(seq);
    if (prev && (prev.grade ?? 99) <= grade) continue;
    bestOrbit.set(seq, {
      seq,
      periodDays,
      e: num(row.e),
      inclDeg: num(row.i),
      omegaDeg: num(row.omega ?? row.om),
      grade,
    });
  }

  const orbits = [];
  for (const [seq, orb] of bestOrbit) {
    const ids = aliases.get(seq) || { names: [], hd: null, hip: null };
    orbits.push({ ...orb, ...ids });
  }
  log?.(`SB9: ${orbits.length} orbits (${aliasRows.length} aliases)`);
  return orbits;
}
