import { equatorialToCartesian, projectToNdc, ndcToScreen } from "../astro/coords.js";
import { luminositySolar, starBrightness, starColor, starPointSize } from "../astro/spectrum.js";
import { estimateSemiMajorAxis, estimateOrbitalPeriodDays } from "../astro/orbits.js";
import { createSolSystem } from "../astro/sol.js";
import { applyGoldilocksZone } from "../astro/habitable.js";
import { applyPlanetColors, estimateRadiusEarthFromMass } from "../astro/planetType.js";
import { STAR_NOTES, getStarNote } from "../content/starNotes.js";
import { TOURS, getTour } from "../content/tours.js";
import { LANDMARK_STARS } from "../content/landmarkStars.js";
import {
  notableBookmarkSize,
  notableBookmarkHitbox,
  distanceToBookmark,
} from "../render/bookmarkLayout.js";

/**
 * In-memory catalog of host systems.
 */
export class Catalog {
  constructor() {
    /** @type {SystemRecord[]} */
    this.systems = [];
    /** @type {Map<string, SystemRecord>} */
    this.byName = new Map();
    /** @type {SystemRecord|null} */
    this.sol = null;
    /** @type {SystemRecord[]} */
    this.notableSystems = [];
    /** @type {string|null} */
    this.activeTourId = null;
    /** Index into notableSystems for the active tour. */
    this.tourIndex = 0;
  }

  /** @param {object[]} rawSystems from loader */
  load(rawSystems) {
    this.systems = [];
    this.byName.clear();
    this.notableSystems = [];
    this.activeTourId = null;
    this.tourIndex = 0;

    // Older snapshots stored NASA st_lum as log10(L/L☉). Convert if needed.
    const systemsIn = convertLogLuminositiesIfNeeded(rawSystems);

    this.sol = createSolSystem();
    this.sol.id = 0;
    applyPlanetColors(this.sol);
    applyGoldilocksZone(this.sol);
    attachStarNote(this.sol);
    this.systems.push(this.sol);
    this.byName.set(this.sol.name, this.sol);

    for (const raw of systemsIn) {
      ingestRawSystem(this, raw);
    }

    for (const raw of LANDMARK_STARS) {
      if (this.byName.has(raw.name)) continue;
      ingestRawSystem(this, raw);
    }

    warnUnmatchedStarNotes(this.byName);
    warnUnmatchedTourStops(this.byName);

    return this;
  }

  /**
   * Attach ≤5 AU stellar companions after load(). Map hosts stay single stars.
   * @param {object[]|object|null|undefined} payload binaries array or { binaries: [] }
   */
  attachCloseBinaries(payload) {
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.binaries)
        ? payload.binaries
        : [];
    for (const raw of list) {
      const name = raw?.hostname;
      if (!name) continue;
      const system = this.byName.get(name);
      if (!system || system.isSol) continue;
      attachBinary(system, raw);
    }
    return this;
  }

  /**
   * Activate a tour: notable ribbons follow its stops, index resets to 0.
   * @param {string} id
   * @returns {SystemRecord|null} first stop, or null if unknown / unmatched
   */
  setActiveTour(id) {
    const tour = getTour(id);
    if (!tour) return null;

    const names = new Set(tour.stops);
    for (const s of this.systems) {
      s.notable = names.has(s.name);
    }
    this.notableSystems = tour.stops
      .map((name) => this.byName.get(name))
      .filter((s) => s?.notable);
    this.activeTourId = id;
    this.tourIndex = 0;
    return this.notableSystems[0] ?? null;
  }

  /** Leave guided mode: no bookmarks, no Next playlist. */
  clearActiveTour() {
    for (const s of this.systems) {
      s.notable = false;
    }
    this.notableSystems = [];
    this.activeTourId = null;
    this.tourIndex = 0;
  }

  /** @returns {import("../content/tours.js").Tour|null} */
  getActiveTour() {
    return getTour(this.activeTourId);
  }

  /**
   * If `system` is on the active tour, move the tour index to that stop.
   * @param {SystemRecord|null|undefined} system
   */
  syncTourIndex(system) {
    if (!system || !this.notableSystems.length) return;
    const i = this.notableSystems.findIndex(
      (s) => s === system || s.name === system.name
    );
    if (i >= 0) this.tourIndex = i;
  }

  /**
   * Next stop on the active tour, wrapping around. Advances tourIndex.
   * @returns {SystemRecord|null}
   */
  nextTourStop() {
    const list = this.notableSystems;
    if (!list.length) return null;
    this.tourIndex = (this.tourIndex + 1) % list.length;
    return list[this.tourIndex];
  }

  /**
   * Nearest system to a screen click (buffer pixels).
   */
  pickNearest(screenX, screenY, viewProj, width, height, maxPx = 18) {
    let best = null;
    let bestScore = maxPx;

    for (const s of this.systems) {
      const ndc = projectToNdc(s, viewProj);
      if (!ndc || ndc.z < -1 || ndc.z > 1) continue;
      if (ndc.x < -1.2 || ndc.x > 1.2 || ndc.y < -1.2 || ndc.y > 1.2) continue;
      const scr = ndcToScreen(ndc, width, height);
      let d = Math.hypot(scr.x - screenX, scr.y - screenY);
      if (s.notable) {
        const clipW =
          viewProj[3] * s.x + viewProj[7] * s.y + viewProj[11] * s.z + viewProj[15];
        const box = notableBookmarkHitbox(scr, notableBookmarkSize(clipW, width));
        d = Math.min(d, distanceToBookmark(screenX, screenY, box));
      }
      // Prefer notables (and slightly Sol) so bookmarks are easy to land on.
      const score = s.notable ? d * 0.55 : s.isSol ? d * 0.85 : d;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }
}

function ingestRawSystem(catalog, raw) {
  if (raw.distPc == null || !(raw.distPc > 0)) return;
  if (raw.ra == null || raw.dec == null) return;

  const pos = equatorialToCartesian(raw.ra, raw.dec, raw.distPc);
  const starMeta = {
    teff: raw.teff,
    spectype: raw.spectype,
    radius: raw.radius,
    luminosity: raw.luminosity,
    vmag: raw.vmag,
    distPc: raw.distPc,
  };

  const planets = (raw.planets || []).map((p, idx) => normalizePlanet(p, raw.mass, idx));
  // PSCompPars has no Ω; share a stable per-host node so coplanarity is system-local.
  const hostNode = hashAngleDeg(raw.name || "Unknown");
  for (const p of planets) {
    if (p.nodeDeg == null) p.nodeDeg = hostNode;
  }

  const system = {
    id: catalog.systems.length,
    name: raw.name || "Unknown",
    label: raw.label ?? raw.name ?? "Unknown",
    ra: raw.ra,
    dec: raw.dec,
    distPc: raw.distPc,
    spectype: raw.spectype || null,
    teff: raw.teff ?? null,
    radius: raw.radius ?? null,
    luminosity: raw.luminosity ?? null,
    vmag: raw.vmag ?? null,
    mass: raw.mass ?? null,
    snum: raw.snum ?? null,
    pnum: raw.pnum ?? planets.length,
    x: pos.x,
    y: pos.y,
    z: pos.z,
    color: starColor(starMeta),
    pointSize: starPointSize(starMeta),
    brightness: starBrightness(starMeta),
    planets,
    aliases: Array.isArray(raw.aliases) ? raw.aliases : [],
  };

  applyPlanetColors(system);
  applyGoldilocksZone(system);
  attachStarNote(system);

  catalog.systems.push(system);
  catalog.byName.set(system.name, system);
}

function normalizePlanet(p, starMass, idx) {
  let a = p.a ?? null;
  let periodDays = p.periodDays ?? null;
  if ((a == null || a <= 0) && periodDays) {
    a = estimateSemiMajorAxis(periodDays, starMass ?? 1);
  }
  if ((periodDays == null || periodDays <= 0) && a && a > 0) {
    periodDays = estimateOrbitalPeriodDays(a, starMass ?? 1);
  }

  let radiusEarth = p.radiusEarth ?? null;
  let radiusJupiter = p.radiusJupiter ?? null;
  let radiusEstimated = false;
  const hasRadius =
    (radiusEarth != null && radiusEarth > 0) ||
    (radiusJupiter != null && radiusJupiter > 0);
  if (!hasRadius) {
    const est = estimateRadiusEarthFromMass(p.massEarth);
    if (est != null) {
      radiusEarth = est;
      radiusEstimated = true;
    }
  }

  return {
    name: p.name || `Planet ${idx + 1}`,
    a,
    periodDays,
    e: clamp(p.e ?? 0, 0, 0.95),
    // Missing i: transit-like prior (~90°) instead of 60° (which coplanarized systems).
    inclDeg: p.inclDeg != null ? p.inclDeg : 90,
    omegaDeg: p.omegaDeg ?? 0,
    nodeDeg: p.nodeDeg ?? null,
    radiusEarth,
    radiusJupiter,
    radiusEstimated,
    massEarth: p.massEarth ?? null,
    discoveryMethod: p.discoveryMethod ?? null,
    discoveryYear: p.discoveryYear ?? null,
    discoveryFacility: p.discoveryFacility ?? null,
    cbFlag: p.cbFlag === true || p.cb_flag === 1,
    around: "bary",
  };
}

/**
 * @param {object} system
 * @param {object} raw
 */
function attachBinary(system, raw) {
  const a = raw.a;
  if (!a || a <= 0 || a > 5) return;

  const curatedStars = Array.isArray(raw.stars) ? raw.stars : [];
  const stars = [0, 1].map((i) => {
    const s = curatedStars[i] || {};
    const letter = s.letter || (i === 0 ? "A" : "B");
    const teff = s.teff ?? (i === 0 ? system.teff : null);
    const radius = s.radius ?? (i === 0 ? system.radius : null);
    const mass = s.mass ?? (i === 0 ? system.mass : null);
    const spectype = s.spectype ?? (i === 0 ? system.spectype : null);
    const luminosity =
      s.luminosity ??
      luminositySolar({
        luminosity: s.luminosity,
        radius,
        teff,
        vmag: i === 0 ? system.vmag : null,
        distPc: system.distPc,
      });
    const meta = { teff, spectype, radius, luminosity, vmag: i === 0 ? system.vmag : null, distPc: system.distPc };
    return {
      letter,
      teff,
      radius,
      mass,
      spectype,
      luminosity,
      color: starColor(meta),
      pointSize: starPointSize(meta),
      brightness: starBrightness(meta),
    };
  });
  if (stars[1].mass == null && stars[1].radius == null && stars[1].teff == null) {
    return;
  }

  const hostNode = system.planets[0]?.nodeDeg ?? hashAngleDeg(system.name);
  const binary = {
    a,
    periodDays: raw.periodDays ?? null,
    e: raw.e ?? 0,
    inclDeg: raw.inclDeg ?? system.planets[0]?.inclDeg ?? 90,
    omegaDeg: raw.omegaDeg ?? 0,
    nodeDeg: raw.nodeDeg ?? hostNode,
    orbitInferred: !!raw.orbitInferred,
    circumbinary: !!raw.circumbinary,
    stars,
  };

  if ((binary.periodDays == null || binary.periodDays <= 0) && stars[0].mass && stars[1].mass) {
    binary.periodDays = estimateOrbitalPeriodDays(a, stars[0].mass + stars[1].mass);
    binary.orbitInferred = true;
  }

  const anyCb = binary.circumbinary || system.planets.some((p) => p.cbFlag);
  const heuristicCb = system.planets.some((p) => p.a != null && p.a > 2 * a);
  binary.circumbinary = anyCb || heuristicCb;

  for (const p of system.planets) {
    if (binary.circumbinary) p.around = "bary";
    else if (p.a != null && p.a < 0.5 * a) p.around = "A";
    else p.around = "bary";
  }

  system.binary = binary;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Deterministic 0–360° from host name (stand-in Ω when catalog has none). */
function hashAngleDeg(name) {
  let h = 2166136261;
  const s = String(name);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 36000) / 100;
}

/**
 * NASA PSCompPars st_lum is log10(L/L☉). Older snapshots stored that raw.
 * If any host has luminosity < 0, treat the whole list as log10 and convert.
 * @param {object[]} systems
 */
function convertLogLuminositiesIfNeeded(systems) {
  const needsConvert = systems.some(
    (s) => s.luminosity != null && s.luminosity < 0
  );
  if (!needsConvert) return systems;
  return systems.map((s) => {
    if (s.luminosity == null) return s;
    return { ...s, luminosity: 10 ** s.luminosity };
  });
}

/**
 * @param {SystemRecord} system
 */
function attachStarNote(system) {
  system.note = getStarNote(system.name) ?? null;
  system.notable = false;
}

/**
 * @param {Map<string, SystemRecord>} byName
 */
function warnUnmatchedStarNotes(byName) {
  for (const key of Object.keys(STAR_NOTES)) {
    if (!byName.has(key)) {
      console.warn(`[starNotes] No catalog system matched hostname "${key}"`);
    }
  }
}

/**
 * @param {Map<string, SystemRecord>} byName
 */
function warnUnmatchedTourStops(byName) {
  for (const tour of TOURS) {
    for (const name of tour.stops) {
      if (!byName.has(name)) {
        console.warn(
          `[tours] ${tour.id}: no catalog system matched hostname "${name}"`
        );
      }
    }
  }
}

/**
 * @typedef {object} SystemRecord
 * @property {number} id
 * @property {string} name
 * @property {string} label
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} distPc
 * @property {[number,number,number]} color
 * @property {number} pointSize
 * @property {number} brightness
 * @property {object[]} planets
 * @property {object} [binary]
 * @property {string[]} [aliases]
 * @property {{text: string}|null} [note]
 * @property {boolean} [notable]
 */
