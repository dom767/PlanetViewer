import { readFile } from "node:fs/promises";
import { assignPlanetAround, shouldDrawBinary } from "../../js/catalog/mergeHosts.js";
import { SystemIndex, extractHd, extractHip } from "./names.mjs";
import {
  CURATED_PATH,
  aFromPeriodMasses,
  kindFromSnum,
  num,
  periodDaysFromMasses,
  projectedSepAu,
  str,
} from "./util.mjs";

function mergeStar(existing, extra, letter, preferExtra = false) {
  const e = existing || {};
  const x = extra || {};
  const pick = (ev, xv) => (preferExtra ? xv ?? ev : ev ?? xv) ?? null;
  return {
    letter: e.letter || x.letter || letter,
    hostname: pick(e.hostname, x.hostname),
    teff: pick(e.teff, x.teff),
    radius: pick(e.radius, x.radius),
    mass: pick(e.mass, x.mass),
    spectype: pick(e.spectype, x.spectype),
    luminosity: pick(e.luminosity, x.luminosity),
    gaiaId: pick(e.gaiaId, x.gaiaId),
  };
}

function ensureStars(system, mass1, mass2, preferCatalog = false) {
  const existing = Array.isArray(system.stars) ? system.stars.map((s) => ({ ...s })) : [];
  const a = existing.find((s) => s.letter === "A") || existing[0] || {};
  const b = existing.find((s) => s.letter === "B") || existing[1] || {};
  const starA = mergeStar(
    {
      ...a,
      teff: a.teff ?? system.teff,
      radius: a.radius ?? system.radius,
      mass: a.mass ?? system.mass,
      spectype: a.spectype ?? system.spectype,
      luminosity: a.luminosity ?? system.luminosity,
    },
    { mass: mass1 },
    "A",
    preferCatalog
  );
  const starB = mergeStar(b, { mass: mass2, letter: "B" }, "B", preferCatalog);
  const rest = existing.filter((s) => s.letter && s.letter !== "A" && s.letter !== "B");
  system.stars = [starA, starB, ...rest];
  return system.stars;
}

function hashAngleDeg(name) {
  let h = 2166136261;
  const s = String(name);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 36000) / 100;
}

function fillPeriod(orbit, stars) {
  if (orbit.periodDays != null && orbit.periodDays > 0) return orbit;
  const m1 = stars?.[0]?.mass;
  const m2 = stars?.[1]?.mass;
  const mTot = (m1 || 0) + (m2 || 0);
  const p = periodDaysFromMasses(orbit.a, mTot);
  if (p) {
    orbit.periodDays = p;
    if (orbit.orbitQuality === "keplerian") {
      /* keep keplerian; P is a derived fill */
    } else if (!orbit.orbitQuality) {
      orbit.orbitQuality = "inferred";
    }
  }
  return orbit;
}

function fillAFromPeriod(orbit, stars) {
  if (orbit.a != null && orbit.a > 0) return orbit;
  const m1 = stars?.[0]?.mass;
  const m2 = stars?.[1]?.mass;
  const mTot = (m1 || 0) + (m2 || 0);
  const a = aFromPeriodMasses(orbit.periodDays, mTot);
  if (a) orbit.a = a;
  return orbit;
}

function fillPlanetAround(system, orbit) {
  orbit.circumbinary = assignPlanetAround(system.planets, orbit);
}

function applyOrbit(system, orbit) {
  const stars = ensureStars(system, orbit.mass1, orbit.mass2, orbit.source === "curated");
  fillAFromPeriod(orbit, stars);
  fillPeriod(orbit, stars);
  if (orbit.a == null || !(orbit.a > 0)) return false;

  const anyCb =
    !!orbit.circumbinary || (system.planets || []).some((p) => p.cbFlag === true);
  const snum = Math.max(system.snum || 1, stars.length, 2);
  system.snum = snum;
  const hostNode = system.planets?.[0]?.nodeDeg ?? hashAngleDeg(system.name);
  const multiplicity = {
    snum,
    kind: kindFromSnum(snum),
    orbitQuality: orbit.orbitQuality || "projected",
    circumbinary: anyCb,
    a: orbit.a,
    periodDays: orbit.periodDays ?? null,
    e: orbit.e ?? null,
    inclDeg: orbit.inclDeg ?? null,
    omegaDeg: orbit.omegaDeg ?? null,
    nodeDeg: orbit.nodeDeg ?? hostNode,
    source: orbit.source,
    drawn: false,
  };
  if (multiplicity.orbitQuality === "inferred" || (orbit.orbitInferred && !orbit.orbitQuality)) {
    multiplicity.orbitQuality = orbit.orbitQuality || "inferred";
  }
  fillPlanetAround(system, multiplicity);
  multiplicity.drawn = shouldDrawBinary({
    a: multiplicity.a,
    circumbinary: multiplicity.circumbinary,
    planets: system.planets,
  });
  system.multiplicity = multiplicity;
  return true;
}

async function loadCurated() {
  const raw = JSON.parse(await readFile(CURATED_PATH, "utf8"));
  return raw.binaries || [];
}

function gaiaProjected(system) {
  const stars = system.stars || [];
  const withPos = stars.filter((s) => s.ra != null && s.dec != null);
  if (withPos.length < 2) return null;
  const a = withPos[0];
  const b = withPos.find((s) => s !== a && (s.gaiaId || "") !== (a.gaiaId || ""));
  if (!b) return null;
  const sep = projectedSepAu(a.ra, a.dec, b.ra, b.dec, system.distPc);
  if (sep == null || sep <= 0) return null;
  return { a: sep, source: "gaia", orbitQuality: "projected" };
}

/**
 * First matching source wins: curated → ORB6 → SB9 → Thebault → Gaia sep.
 */
export async function applyOrbitCascade(systems, catalogs, log) {
  const { orb6, sb9, thebault } = catalogs;
  const curated = await loadCurated();
  const index = new SystemIndex(systems);
  const unmatchedCurated = [];
  const claimed = new Set();

  for (const sys of systems) {
    delete sys.multiplicity;
  }

  const mark = (sys, orbit) => {
    if (!sys || claimed.has(sys.name)) return false;
    if (applyOrbit(sys, orbit)) {
      claimed.add(sys.name);
      return true;
    }
    return false;
  };

  log?.(`Cascade: ${curated.length} curated CBP overrides`);
  for (const cur of curated) {
    const sys = index.find(cur.hostname, { loose: false });
    if (!sys) {
      unmatchedCurated.push(cur.hostname);
      log?.(`  unmatched curated host: ${cur.hostname}`);
      continue;
    }
    const stars = cur.stars || [];
    mark(sys, {
      source: "curated",
      orbitQuality: "keplerian",
      circumbinary: cur.circumbinary === true,
      a: num(cur.a) ?? num(cur.sepAu),
      periodDays: num(cur.periodDays),
      e: num(cur.e),
      inclDeg: num(cur.inclDeg),
      omegaDeg: num(cur.omegaDeg),
      nodeDeg: num(cur.nodeDeg),
      mass1: stars[0]?.mass,
      mass2: stars[1]?.mass,
    });
    if (stars.length) {
      sys.stars = [
        mergeStar(sys.stars?.find((s) => s.letter === "A") || sys.stars?.[0], stars[0], "A", true),
        mergeStar(sys.stars?.find((s) => s.letter === "B") || sys.stars?.[1], stars[1], "B", true),
        ...(sys.stars || []).filter((s) => s.letter && s.letter !== "A" && s.letter !== "B"),
      ];
    }
  }

  log?.(`Cascade: ORB6 (${orb6.length})`);
  let nOrb6 = 0;
  for (const row of orb6) {
    const sys = index.find(null, { hd: row.hd, hip: row.hip });
    if (!sys || claimed.has(sys.name)) continue;
    const a = row.aArcsec * sys.distPc;
    if (!a || a <= 0) continue;
    if (mark(sys, {
      source: "orb6",
      orbitQuality: "keplerian",
      a,
      periodDays: row.periodDays,
      e: row.e,
      inclDeg: row.inclDeg,
      omegaDeg: row.omegaDeg,
      nodeDeg: row.nodeDeg,
    })) nOrb6++;
  }
  log?.(`  matched ${nOrb6}`);

  log?.(`Cascade: SB9 (${sb9.length})`);
  let nSb9 = 0;
  for (const row of sb9) {
    const sys = index.find(row.names[0], { hd: row.hd, hip: row.hip, alt: row.names[1] });
    if (!sys || claimed.has(sys.name)) continue;
    if (mark(sys, {
      source: "sb9",
      orbitQuality: "keplerian",
      periodDays: row.periodDays,
      e: row.e,
      inclDeg: row.inclDeg ?? 90,
      omegaDeg: row.omegaDeg,
      mass1: sys.mass,
      mass2: sys.stars?.[1]?.mass,
    })) nSb9++;
  }
  log?.(`  matched ${nSb9}`);

  const thebaultAll = [...(thebault.pType || []), ...(thebault.sType || [])];
  log?.(`Cascade: Thebault (${thebaultAll.length})`);
  let nTh = 0;
  for (const row of thebaultAll) {
    const sys = index.find(row.name, {
      alt: row.alt,
      gaia: row.gaia,
      hd: extractHd(row.name) || extractHd(row.alt),
      hip: extractHip(row.name) || extractHip(row.alt),
      loose: true,
    });
    if (!sys || claimed.has(sys.name)) continue;
    const knownE = row.e != null && row.e < 90;
    if (mark(sys, {
      source: "thebault",
      orbitQuality: knownE ? "keplerian" : "projected",
      circumbinary: !!row.circumbinary,
      a: row.a,
      e: knownE ? row.e : null,
      mass1: row.mass1,
      mass2: row.mass2,
    })) nTh++;
  }
  log?.(`  matched ${nTh}`);

  log?.("Cascade: Gaia projected separations from stellarhosts");
  let nGaia = 0;
  for (const sys of systems) {
    if (claimed.has(sys.name)) continue;
    if ((sys.snum || 1) < 2 && !(sys.stars?.length >= 2)) continue;
    const proj = gaiaProjected(sys);
    if (!proj) continue;
    if (mark(sys, proj)) nGaia++;
  }
  log?.(`  matched ${nGaia}`);

  for (const sys of systems) {
    if ((sys.snum || 1) < 2 && !(sys.stars?.length >= 2)) continue;
    if (!sys.stars?.length) {
      sys.stars = [
        {
          letter: "A",
          teff: sys.teff,
          radius: sys.radius,
          mass: sys.mass,
          spectype: sys.spectype,
          luminosity: sys.luminosity,
          gaiaId: sys.gaiaId || null,
        },
      ];
    }
    if (sys.multiplicity) continue;
    const snum = Math.max(sys.snum || 1, sys.stars.length);
    sys.snum = snum;
    sys.multiplicity = {
      snum,
      kind: kindFromSnum(snum),
      orbitQuality: "projected",
      circumbinary: (sys.planets || []).some((p) => p.cbFlag),
      a: null,
      periodDays: null,
      e: null,
      inclDeg: null,
      omegaDeg: null,
      nodeDeg: null,
      source: "snum",
      drawn: false,
    };
  }

  const withMult = systems.filter((s) => s.multiplicity);
  const stats = {
    multiples: withMult.length,
    drawn: withMult.filter((s) => s.multiplicity.drawn).length,
    infoOnly: withMult.filter((s) => !s.multiplicity.drawn).length,
    circumbinary: withMult.filter((s) => s.multiplicity.circumbinary).length,
    byQuality: { keplerian: 0, inferred: 0, projected: 0 },
    bySource: {},
    unmatchedCurated,
  };
  for (const s of withMult) {
    const q = s.multiplicity.orbitQuality || "projected";
    stats.byQuality[q] = (stats.byQuality[q] || 0) + 1;
    const src = s.multiplicity.source || "unknown";
    stats.bySource[src] = (stats.bySource[src] || 0) + 1;
  }
  log?.(
    `Multiples ${stats.multiples} · drawn ${stats.drawn} · info-only ${stats.infoOnly} · CBP ${stats.circumbinary}`
  );
  return { stats, unmatchedCurated };
}

export function binariesArtifact(systems) {
  const binaries = [];
  for (const s of systems) {
    const m = s.multiplicity;
    if (!m || !m.a) continue;
    binaries.push({
      hostname: s.name,
      a: m.a,
      periodDays: m.periodDays,
      e: m.e,
      inclDeg: m.inclDeg,
      omegaDeg: m.omegaDeg,
      nodeDeg: m.nodeDeg,
      orbitInferred: m.orbitQuality === "inferred",
      orbitQuality: m.orbitQuality,
      circumbinary: !!m.circumbinary,
      drawn: !!m.drawn,
      source: m.source,
      stars: (s.stars || []).map((st) => ({
        letter: st.letter,
        teff: st.teff,
        radius: st.radius,
        mass: st.mass,
        spectype: st.spectype,
      })),
    });
  }
  binaries.sort((a, b) => a.hostname.localeCompare(b.hostname));
  return binaries;
}
