/**
 * Fold NASA A/B (or C/D) hostname rows that sit at the same sky position
 * into one catalog system. Planets keep `around` as the component letter.
 */

/** @param {string|null|undefined} hostname */
export function letterFromHostname(hostname) {
  const m = /(?:^|[\s-])([A-D])$/i.exec(String(hostname || "").trim());
  return m ? m[1].toUpperCase() : null;
}

/** @param {string|null|undefined} name */
export function stripComponentSuffix(name) {
  return String(name || "")
    .replace(/\*+\s*$/, "")
    .replace(/\s+(AB|BC|AC|[A-D])$/i, "")
    .trim();
}

/** @param {string|null|undefined} around */
export function isComponentAround(around) {
  return around === "A" || around === "B" || around === "C" || around === "D";
}

/** True when at least two planets name different host letters (A/B/…). */
export function planetsOrbitMultipleComponents(planets) {
  const letters = new Set();
  for (const p of planets || []) {
    if (isComponentAround(p?.around)) letters.add(p.around);
  }
  return letters.size >= 2;
}

/**
 * Draw companion in the focused orbit view if the pair is close, a planet
 * reaches ≥5% of the binary orbit, or planets orbit more than one component.
 */
export function shouldDrawBinary({ a, circumbinary, planets }) {
  if (a == null || !(a > 0)) return false;
  if (planetsOrbitMultipleComponents(planets)) return true;
  if (circumbinary && a <= 1) return true;
  if (a <= 5) return true;
  let outer = 0;
  for (const p of planets || []) {
    if (p?.a != null && p.a > outer) outer = p.a;
  }
  return outer > 0 && a <= 20 * outer;
}

/**
 * Angular separation in degrees → projected AU at distPc.
 * 1 arcsec at 1 pc = 1 AU.
 */
export function projectedSepAu(ra1, dec1, ra2, dec2, distPc) {
  if ([ra1, dec1, ra2, dec2, distPc].some((v) => v == null || !Number.isFinite(v))) {
    return null;
  }
  if (distPc <= 0) return null;
  const d2r = Math.PI / 180;
  const cosd =
    Math.sin(dec1 * d2r) * Math.sin(dec2 * d2r) +
    Math.cos(dec1 * d2r) * Math.cos(dec2 * d2r) * Math.cos((ra1 - ra2) * d2r);
  const deg = Math.acos(Math.min(1, Math.max(-1, cosd))) / d2r;
  return deg * 3600 * distPc;
}

/** Merge if the two hosts are the same map position (not resolved A/B pairs). */
const MAX_SEP_AU = 50;
const MAX_SEP_ARCSEC = 2;

function colocated(a, b) {
  const da = a.distPc;
  const db = b.distPc;
  if (!(da > 0) || !(db > 0)) return false;
  const distTol = Math.max(0.25, 0.02 * Math.min(da, db));
  if (Math.abs(da - db) > distTol) return false;
  const sepAu = projectedSepAu(a.ra, a.dec, b.ra, b.dec, da);
  if (sepAu != null && sepAu <= MAX_SEP_AU) return true;
  if (sepAu == null) return false;
  const arcsec = sepAu / da;
  return arcsec <= MAX_SEP_ARCSEC;
}

function groupKey(system) {
  const raw = system.syName || stripComponentSuffix(system.name) || system.name;
  return String(raw).toLowerCase();
}

const QUALITY_RANK = { keplerian: 3, inferred: 2, projected: 1 };
/** Prefer literature cascades over Gaia projected seps when quality ties. */
const SOURCE_RANK = {
  curated: 6,
  orb6: 5,
  sb9: 4,
  thebault: 3,
  gaia: 2,
  snum: 1,
};

function betterMultiplicity(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const ra = QUALITY_RANK[a.orbitQuality] || 0;
  const rb = QUALITY_RANK[b.orbitQuality] || 0;
  if (ra !== rb) return ra > rb ? a : b;
  const sa = SOURCE_RANK[String(a.source || "").toLowerCase()] || 0;
  const sb = SOURCE_RANK[String(b.source || "").toLowerCase()] || 0;
  if (sa !== sb) return sa > sb ? a : b;
  const aa = a.a != null && a.a > 0 ? a.a : 0;
  const ba = b.a != null && b.a > 0 ? b.a : 0;
  // Same quality/source: prefer the wider published separation over a tiny
  // Gaia glitch (e.g. TOI-2267 Thebault 8 AU vs Gaia 0.1 AU).
  if (aa !== ba) return aa > ba ? a : b;
  return a;
}

function pickPrimary(members) {
  return (
    members.find((s) => letterFromHostname(s.name) === "A") ||
    members.find((s) => !letterFromHostname(s.name)) ||
    members[0]
  );
}

function clusterColocated(members) {
  const clusters = [];
  for (const s of members) {
    const hit = clusters.find((c) => c.some((o) => colocated(o, s)));
    if (hit) hit.push(s);
    else clusters.push([s]);
  }
  return clusters;
}

function planetAroundFromHost(planet, hostLetter) {
  if (planet.cbFlag === true || planet.cb_flag === 1) return "bary";
  if (hostLetter) return hostLetter;
  if (isComponentAround(planet.around)) return planet.around;
  return planet.around || null;
}

function mergeCluster(members) {
  if (members.length === 1) return members[0];

  const primary = pickPrimary(members);
  const canonical =
    primary.syName || stripComponentSuffix(primary.name) || primary.name;
  const aliases = new Set();
  for (const m of members) {
    if (m.name && m.name !== canonical) aliases.add(m.name);
    for (const a of m.aliases || []) {
      if (a && a !== canonical) aliases.add(a);
    }
  }

  const planets = [];
  const seen = new Set();
  for (const m of members) {
    const letter = letterFromHostname(m.name);
    for (const p of m.planets || []) {
      if (!p?.name || seen.has(p.name)) continue;
      seen.add(p.name);
      planets.push({ ...p, around: planetAroundFromHost(p, letter) });
    }
  }

  let multiplicity = primary.multiplicity || null;
  let stars = Array.isArray(primary.stars) ? primary.stars : null;
  for (const m of members) {
    multiplicity = betterMultiplicity(multiplicity, m.multiplicity);
    if ((m.stars?.length || 0) > (stars?.length || 0)) stars = m.stars;
  }
  if (multiplicity) {
    multiplicity = {
      ...multiplicity,
      drawn: shouldDrawBinary({
        a: multiplicity.a,
        circumbinary: multiplicity.circumbinary,
        planets,
      }),
    };
  }

  // One shared stand-in Ω across merged A/B hosts so the binary fallback
  // (Thebault/Gaia) cannot keep a different hash than the planets.
  const sharedNode =
    (primary.planets || []).find((p) => p.nodeDeg != null)?.nodeDeg ??
    hashAngleDeg(canonical);
  for (const p of planets) {
    if (isStandInNodeDeg(p.nodeDeg, [primary.name, ...(primary.aliases || []), ...aliases, canonical])) {
      p.nodeDeg = sharedNode;
    }
  }

  const snum = Math.max(
    ...members.map((m) => m.snum || 1),
    stars?.length || 1,
    primary.snum || 1
  );

  const merged = {
    ...primary,
    name: canonical,
    label: stripComponentSuffix(primary.label || primary.name) || canonical,
    aliases: [...aliases],
    planets,
    pnum: planets.length,
    snum,
    stars,
    multiplicity,
  };
  if (merged.multiplicity) alignOrbitNodes(merged, merged.multiplicity);
  return merged;
}

/**
 * @param {object[]} systems
 * @returns {object[]}
 */
export function mergeCoLocatedComponentHosts(systems) {
  if (!Array.isArray(systems) || systems.length < 2) return systems || [];

  const groups = new Map();
  const singles = [];
  for (const s of systems) {
    if (!s?.name || !letterFromHostname(s.name)) {
      singles.push(s);
      continue;
    }
    const key = groupKey(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }

  const out = [...singles];
  for (const members of groups.values()) {
    if (members.length === 1) {
      out.push(members[0]);
      continue;
    }
    for (const cluster of clusterColocated(members)) {
      out.push(mergeCluster(cluster));
    }
  }
  return out.sort((a, b) => (a.distPc ?? 0) - (b.distPc ?? 0));
}

/**
 * Fill `around` for planets that do not already name a component.
 * @param {object[]} planets
 * @param {{ a?: number|null, circumbinary?: boolean }} orbit
 * @returns {boolean} whether the system is treated as circumbinary
 */
export function assignPlanetAround(planets, orbit) {
  const list = planets || [];
  const a = orbit?.a;
  const cb = !!orbit?.circumbinary || list.some((p) => p.cbFlag === true);
  const heuristicCb = list.some((p) => p.a != null && a && p.a > 2 * a);
  const isCb = cb || heuristicCb;
  for (const p of list) {
    if (isComponentAround(p.around)) continue;
    if (isCb || p.cbFlag) p.around = "bary";
    else if (a != null && p.a != null && p.a < 0.5 * a) p.around = "A";
    else p.around = "bary";
  }
  return isCb;
}

/** Deterministic 0–360° stand-in Ω when the archive has none. */
export function hashAngleDeg(name) {
  let h = 2166136261;
  const s = String(name || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 36000) / 100;
}

/** Sources that can supply a real binary longitude of ascending node. */
const AUTHORITATIVE_NODE_SOURCES = new Set(["orb6", "curated"]);

/**
 * True when the binary orbit carries a published Ω (not a host-name hash).
 * Thebault / Gaia / SB9 / snum do not publish a usable node for our viz frame.
 */
export function binaryHasAuthoritativeNode(orbit) {
  if (!orbit) return false;
  const src = String(orbit.source || "").toLowerCase();
  if (!AUTHORITATIVE_NODE_SOURCES.has(src)) return false;
  return orbit.nodeDeg != null && Number.isFinite(orbit.nodeDeg);
}

function nearlyEqualAngle(a, b) {
  if (a == null || b == null) return false;
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d < 0.05 || d > 359.95;
}

/** True when nodeDeg matches a hash stand-in for one of the host names. */
export function isStandInNodeDeg(nodeDeg, names) {
  if (nodeDeg == null || !Number.isFinite(nodeDeg)) return true;
  for (const n of names || []) {
    if (n && nearlyEqualAngle(nodeDeg, hashAngleDeg(n))) return true;
  }
  return false;
}

/**
 * Keep the focus camera, planets, and drawn binary on one viz plane.
 * - Non-authoritative binary Ω → copy from planets.
 * - Authoritative binary Ω (ORB6 / curated) → copy onto planets whose Ω is a stand-in.
 * Does not touch inclDeg.
 *
 * @param {object} system
 * @param {object} orbit multiplicity / binary record (mutated)
 * @returns {object} orbit
 */
export function alignOrbitNodes(system, orbit) {
  if (!system || !orbit) return orbit;
  const planets = system.planets || [];
  const names = [
    system.name,
    ...(system.aliases || []),
  ].filter(Boolean);

  if (binaryHasAuthoritativeNode(orbit)) {
    for (const p of planets) {
      if (isStandInNodeDeg(p.nodeDeg, names)) p.nodeDeg = orbit.nodeDeg;
    }
    return orbit;
  }

  const planetNode =
    planets.find((p) => p.nodeDeg != null && Number.isFinite(p.nodeDeg))?.nodeDeg ??
    hashAngleDeg(system.name);
  orbit.nodeDeg = planetNode;
  return orbit;
}
